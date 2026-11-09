import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { database, throwawayOrg } from '../helpers';

// Webhooks a customer never sees being sent: a renewal the card declines, a
// renewal the bank wants confirmed, an event that is not ours, and the same
// event delivered twice. Stripe TEST mode on a test clock, webhooks through
// `stripe listen` (see README); the last one is posted straight to the
// backend, signed with STRIPE_SIGNING_KEY like Stripe signs a redelivery.

const sk = process.env.STRIPE_SECRET_KEY || '';
test.skip(!sk.startsWith('sk_test_'), 'needs Stripe test-mode keys');
const stripe = new Stripe(sk);
const MONTH = 31 * 86_400;

let prisma: PrismaClient;
const cleanup: (() => Promise<unknown>)[] = [];
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  await prisma.$disconnect();
});
test.describe.configure({ mode: 'serial', timeout: 6 * 60_000 });

const tierOf = async (orgId: string) =>
  (await prisma.subscription.findFirst({ where: { organizationId: orgId, deletedAt: null }, orderBy: { createdAt: 'desc' } }))
    ?.subscriptionTier ?? 'FREE';

const notes = async (orgId: string) =>
  (await prisma.notifications.findMany({ where: { organizationId: orgId }, select: { content: true } })).map((n) => n.content);

// A Pro organisation paying monthly with a working card, on a test clock.
const payingPro = async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
  const customer = await stripe.customers.create({ test_clock: clock.id, email: `${org.orgId}@example.com` });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  await prisma.organization.update({ where: { id: org.orgId }, data: { paymentId: customer.id, allowTrial: false } });
  cleanup.push(() => org.remove(), () => stripe.testHelpers.testClocks.del(clock.id));
  const product = await stripe.products.create({ name: 'Off-path PRO' });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price_data: { currency: 'gbp', product: product.id, unit_amount: 2900, recurring: { interval: 'month' } } }],
    metadata: { service: 'gitroom', billing: 'PRO', period: 'MONTHLY' },
  });
  await expect.poll(() => tierOf(org.orgId), { timeout: 60_000 }).toBe('PRO');
  return { ...org, clock: clock.id, customer: customer.id, sub: sub.id };
};

// The renewal is charged to `card` (a Stripe test card).
const renewWith = async (o: Awaited<ReturnType<typeof payingPro>>, card: string) => {
  const pm = await stripe.paymentMethods.attach(card, { customer: o.customer });
  await stripe.customers.update(o.customer, { invoice_settings: { default_payment_method: pm.id } });
  await stripe.subscriptions.update(o.sub, { default_payment_method: pm.id });
  const c = await stripe.testHelpers.testClocks.retrieve(o.clock);
  await stripe.testHelpers.testClocks.advance(o.clock, { frozen_time: c.frozen_time + MONTH });
  await expect
    .poll(async () => (await stripe.testHelpers.testClocks.retrieve(o.clock)).status, { timeout: 180_000, intervals: [2_000] })
    .toBe('ready');
};

test('a renewal the card declines tells the customer, and the plan stays while Stripe retries', async () => {
  const o = await payingPro();
  await renewWith(o, 'pm_card_chargeCustomerFail');
  await expect.poll(async () => (await stripe.subscriptions.retrieve(o.sub)).status, { timeout: 60_000 }).toBe('past_due');
  await expect
    .poll(async () => (await notes(o.orgId)).some((n) => n.includes("couldn't process your latest payment")), { timeout: 60_000 })
    .toBe(true);
  expect(await tierOf(o.orgId)).toBe('PRO');
});

test('a renewal the bank wants confirmed sends the customer to the invoice page', async () => {
  const o = await payingPro();
  await renewWith(o, 'pm_card_authenticationRequired');
  const asked = async () => (await notes(o.orgId)).find((n) => n.includes('Your bank needs you to confirm')) ?? '';
  // The link is the renewal invoice's own page (Stripe signs a fresh URL on
  // every read, so the address itself is not compared).
  await expect.poll(asked, { timeout: 90_000 }).toMatch(/https:\/\/invoice\.stripe\.com\/i\/\S+/);
  const renewal = (await stripe.invoices.list({ subscription: o.sub, limit: 1, expand: ['data.payments'] })).data[0];
  expect(renewal.status).toBe('open');
  expect(renewal.billing_reason).toBe('subscription_cycle');
  expect(await tierOf(o.orgId)).toBe('PRO');
});

test('an event that is not ours is acknowledged and changes nothing', async () => {
  // Another product on the same Stripe account: no `service: gitroom`.
  const customer = await stripe.customers.create({ email: `not-ours-${Date.now()}@example.com` });
  cleanup.push(() => stripe.customers.del(customer.id));
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  const product = await stripe.products.create({ name: 'Not Postra' });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    default_payment_method: pm.id,
    items: [{ price_data: { currency: 'gbp', product: product.id, unit_amount: 500, recurring: { interval: 'month' } } }],
  });
  const created = async () =>
    (await stripe.events.list({ type: 'customer.subscription.created', limit: 20 })).data.find(
      (e) => (e.data.object as Stripe.Subscription).id === sub.id
    )?.id ?? '';
  await expect.poll(created, { timeout: 30_000 }).not.toBe('');
  const eventId = await created();
  // Delivered and answered (it is not ours, so not recorded as handled), and
  // no organisation got this customer or a plan from it.
  await new Promise((r) => setTimeout(r, 5_000));
  expect(await prisma.stripeProcessedEvent.count({ where: { id: eventId } })).toBe(0);
  expect(await prisma.organization.count({ where: { paymentId: customer.id } })).toBe(0);
  expect(await prisma.subscription.count({ where: { organization: { paymentId: customer.id } } })).toBe(0);
});

test('the same event delivered again is a duplicate and grants nothing twice', async () => {
  const secret = process.env.STRIPE_SIGNING_KEY || '';
  test.skip(!secret.startsWith('whsec_'), 'needs the signing key of `stripe listen`');
  const o = await payingPro();
  const paid = async () =>
    (await stripe.events.list({ type: 'invoice.payment_succeeded', limit: 30 })).data.find(
      (e) => (e.data.object as Stripe.Invoice).customer === o.customer
    );
  await expect.poll(async () => !!(await paid()), { timeout: 60_000 }).toBe(true);
  const event = (await paid())!;
  await expect.poll(() => prisma.stripeProcessedEvent.count({ where: { id: event.id } }), { timeout: 60_000 }).toBe(1);
  const subsBefore = await prisma.subscription.count({ where: { organizationId: o.orgId } });
  const orgBefore = await prisma.organization.findUnique({ where: { id: o.orgId } });

  const payload = JSON.stringify(event);
  const res = await fetch('http://localhost:53000/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }),
    },
    body: payload,
  });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ ok: true, duplicate: true });
  expect(await prisma.stripeProcessedEvent.count({ where: { id: event.id } })).toBe(1);
  expect(await prisma.subscription.count({ where: { organizationId: o.orgId } })).toBe(subsBefore);
  expect(await prisma.organization.findUnique({ where: { id: o.orgId } })).toEqual(orgBefore);
});
