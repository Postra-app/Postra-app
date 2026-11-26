import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { database, throwawayOrg } from '../helpers';
import { TRIAL_DAYS } from '../../../libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing';

// The free trial without a card, from start to end, against Stripe TEST mode:
// the app's own endpoints, the webhook delivered by `stripe listen`, and a
// test clock that moves the trial to its reminder and to its end. Run with
// `pnpm e2e:stack:billing` (see README).

const sk = process.env.STRIPE_SECRET_KEY || '';
test.skip(!sk.startsWith('sk_test_'), 'needs Stripe test-mode keys');
const stripe = new Stripe(sk);
const DAY = 86_400;

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

// A new account: no plan yet, the trial on offer, a Stripe customer on a test
// clock (the trial starts on it, so the clock can move it).
const newAccount = async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 8, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: org.orgId } });
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
  const customer = await stripe.customers.create({ test_clock: clock.id, email: `${org.orgId}@example.com` });
  await prisma.organization.update({
    where: { id: org.orgId },
    data: { paymentId: customer.id, allowTrial: true, isTrailing: true },
  });
  cleanup.push(
    () => org.remove(),
    () => stripe.testHelpers.testClocks.del(clock.id)
  );
  return { ...org, clock: clock.id, customer: customer.id };
};

const tierOf = async (orgId: string) =>
  (await prisma.subscription.findFirst({ where: { organizationId: orgId, deletedAt: null } }))?.subscriptionTier ??
  'FREE';

const advanceTo = async (clock: string, to: number) => {
  await stripe.testHelpers.testClocks.advance(clock, { frozen_time: to });
  await expect
    .poll(async () => (await stripe.testHelpers.testClocks.retrieve(clock)).status, { timeout: 180_000, intervals: [2_000] })
    .toBe('ready');
};

const notes = async (orgId: string) =>
  (await prisma.notifications.findMany({ where: { organizationId: orgId }, select: { content: true } })).map((n) => n.content);

const start = async (account: Awaited<ReturnType<typeof newAccount>>) => {
  const res = await account.api.post('/billing/start-trial', { data: { billing: 'PRO', period: 'MONTHLY' } });
  expect(res.status(), await res.text()).toBe(201);
  const { id } = await res.json();
  await expect
    .poll(async () => (await (await account.api.get(`/billing/check/${id}`)).json()).status, { timeout: 90_000 })
    .toBe(2);
  const [subscription] = (await stripe.subscriptions.list({ customer: account.customer, status: 'all' })).data;
  return subscription;
};

test('a trial starts without a card, is reminded, and ends with everything saved', async () => {
  const account = await newAccount();
  const subscription = await start(account);

  expect(subscription.status).toBe('trialing');
  expect((subscription.trial_end! - subscription.trial_start!) / DAY).toBe(TRIAL_DAYS);
  expect(subscription.default_payment_method).toBeNull();
  expect(await tierOf(account.orgId)).toBe('PRO');
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: account.orgId } });
  expect(org.isTrailing).toBe(true);
  expect(org.allowTrial).toBe(false);

  // The bar's numbers.
  const bar = await (await account.api.get('/billing/trial')).json();
  expect(bar).toMatchObject({ trial: true, hasCard: false, channels: { used: 0, limit: 2 }, posts: { used: 0, limit: 15 } });

  // One trial: a second start is refused.
  expect((await account.api.post('/billing/start-trial', { data: { billing: 'PRO', period: 'MONTHLY' } })).status()).toBe(409);

  // Ending it early without a card asks for one, and leaves the trial alone.
  expect(await (await account.api.post('/billing/finish-trial')).json()).toEqual({ finish: false, reason: 'no-card' });
  expect((await stripe.subscriptions.retrieve(subscription.id)).status).toBe('trialing');

  // Three days before the end: how to keep the plan, and that nothing is charged.
  await advanceTo(account.clock, subscription.trial_end! - 3 * DAY + 3600);
  await expect
    .poll(async () => (await notes(account.orgId)).some((n) => n.includes('To keep your plan, add a card in Billing')), {
      timeout: 120_000,
    })
    .toBe(true);
  expect((await notes(account.orgId)).some((n) => n.includes('will be charged'))).toBe(false);

  // The end: Stripe cancels it, the plan ends, the customer is told once.
  await advanceTo(account.clock, subscription.trial_end! + 3600);
  await expect.poll(() => tierOf(account.orgId), { timeout: 120_000 }).toBe('FREE');
  expect((await stripe.subscriptions.retrieve(subscription.id)).status).toBe('canceled');
  await expect
    .poll(async () => (await notes(account.orgId)).filter((n) => n.includes('Your free trial of Postra Pro has ended')).length, {
      timeout: 120_000,
    })
    .toBe(1);

  // The plan screen says the trial has ended, and offers no second one.
  const checkout = await (await account.api.post('/billing/embedded', { data: { billing: 'PRO', period: 'MONTHLY' } })).json();
  expect(checkout.trialEnded).toBe(true);
  expect(checkout.trial).toBe(false);
  expect((await account.api.post('/billing/start-trial', { data: { billing: 'PRO', period: 'MONTHLY' } })).status()).toBe(409);
});

test('a card added during the trial keeps the plan: charged at the end, full limits after', async () => {
  const account = await newAccount();
  const subscription = await start(account);

  // What the portal's "add a payment method" page does: the customer's
  // default card for invoices.
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: account.customer });
  await stripe.customers.update(account.customer, { invoice_settings: { default_payment_method: pm.id } });
  expect((await (await account.api.get('/billing/trial')).json()).hasCard).toBe(true);

  await advanceTo(account.clock, subscription.trial_end! + 2 * 3600);
  await expect.poll(async () => (await stripe.subscriptions.retrieve(subscription.id)).status, { timeout: 120_000 }).toBe('active');
  await expect
    .poll(async () => (await prisma.organization.findUniqueOrThrow({ where: { id: account.orgId } })).isTrailing, {
      timeout: 120_000,
    })
    .toBe(false);
  expect(await tierOf(account.orgId)).toBe('PRO');
  const [invoice] = (await stripe.invoices.list({ customer: account.customer, status: 'paid', limit: 1 })).data;
  expect(invoice.amount_paid).toBe(2900);
  expect((await notes(account.orgId)).some((n) => n.includes('has ended'))).toBe(false);
});
