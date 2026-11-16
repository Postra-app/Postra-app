import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { database, throwawayOrg } from '../helpers';

// Three days before a trial ends Stripe sends customer.subscription.trial_will_end.
// The reminder the customer gets is Postra's own: the date, the plan, the
// card and the amount, once, and nothing for a trial that will not be
// charged. Stripe TEST mode; the event is posted straight to the backend,
// signed with STRIPE_SIGNING_KEY, the way Stripe delivers (and redelivers) it.

const sk = process.env.STRIPE_SECRET_KEY || '';
const secret = process.env.STRIPE_SIGNING_KEY || '';
test.skip(!sk.startsWith('sk_test_'), 'needs Stripe test-mode keys');
test.skip(!secret.startsWith('whsec_'), 'needs the webhook signing key the backend runs with');
const stripe = new Stripe(sk);

let prisma: PrismaClient;
const cleanup: (() => Promise<unknown>)[] = [];
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  await prisma.$disconnect();
});
test.describe.configure({ mode: 'serial', timeout: 2 * 60_000 });

const notes = async (orgId: string) =>
  (await prisma.notifications.findMany({ where: { organizationId: orgId }, select: { content: true } })).map((n) => n.content);

const deliver = (event: Record<string, unknown>) => {
  const payload = JSON.stringify(event);
  return fetch('http://localhost:53000/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }),
    },
    body: payload,
  });
};

// A Starter trial on a Visa test card, owned by a throwaway organisation.
const starterTrial = async (over: Partial<Stripe.SubscriptionCreateParams> = {}) => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0, isTrailing: true });
  const customer = await stripe.customers.create({ email: `${org.orgId}@example.com` });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await prisma.organization.update({ where: { id: org.orgId }, data: { paymentId: customer.id, allowTrial: false } });
  const product = await stripe.products.create({ name: 'Trial reminder Starter', metadata: { tier: 'STANDARD' } });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    default_payment_method: pm.id,
    trial_period_days: 7,
    items: [{ price_data: { currency: 'gbp', product: product.id, unit_amount: 1900, recurring: { interval: 'month' } } }],
    metadata: { service: 'gitroom', billing: 'STANDARD', period: 'MONTHLY' },
    ...over,
  });
  cleanup.push(
    () => org.remove(),
    () => stripe.customers.del(customer.id),
    () => stripe.products.update(product.id, { active: false })
  );
  const event = {
    id: `evt_stack_trial_${sub.id}`,
    object: 'event',
    api_version: '2025-01-01',
    created: Math.floor(Date.now() / 1000),
    type: 'customer.subscription.trial_will_end',
    data: { object: sub },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  };
  return { orgId: org.orgId, sub, event };
};

test('a trial that will be charged gets one reminder with the date, the card and the amount', async () => {
  const t = await starterTrial();
  const ends = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' }).format(
    new Date((t.sub.trial_end as number) * 1000)
  );

  const res = await deliver(t.event);
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ ok: true });
  expect(await notes(t.orgId)).toEqual([
    `Your free trial of Postra Starter ends on ${ends}. After that, your card ending 4242 will be charged £19 a month. Want to keep going? There is nothing to do. To cancel or change your plan, open Billing: ${process.env.FRONTEND_URL}/billing`,
  ]);

  // Stripe delivers again: no second reminder.
  const again = await deliver(t.event);
  expect(again.status).toBe(201);
  expect(await again.json()).toEqual({ ok: true, duplicate: true });
  expect(await notes(t.orgId)).toHaveLength(1);
});

test('a trial cancelled before it ends gets no reminder', async () => {
  const t = await starterTrial({ cancel_at_period_end: true });
  const res = await deliver(t.event);
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ ok: true, skipped: expect.any(String) });
  expect(await notes(t.orgId)).toEqual([]);
});
