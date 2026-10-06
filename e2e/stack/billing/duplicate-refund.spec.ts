import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { database, throwawayOrg } from '../helpers';

// E2E-07-30 (upstream 28e71678 + 4913031d): a second live subscription for a
// customer who already pays is cancelled by the webhook — and now its payment
// is refunded too. Stripe TEST mode, webhooks through `stripe listen`.

const sk = process.env.STRIPE_SECRET_KEY || '';
test.skip(!sk.startsWith('sk_test_'), 'needs Stripe test-mode keys');
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
test.describe.configure({ timeout: 5 * 60_000 });

test('a duplicate subscription is cancelled and its payment refunded', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  cleanup.push(() => org.remove());
  const customer = await stripe.customers.create({ email: `${org.orgId}@example.com` });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  await prisma.organization.update({ where: { id: org.orgId }, data: { paymentId: customer.id, allowTrial: false } });
  cleanup.push(() => stripe.customers.del(customer.id));
  const product = await stripe.products.create({ name: 'Duplicate PRO' });
  const subscribe = () =>
    stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price_data: { currency: 'gbp', product: product.id, unit_amount: 2900, recurring: { interval: 'month' } } }],
      metadata: { service: 'gitroom', billing: 'PRO', period: 'MONTHLY' },
    });

  const first = await subscribe();
  await expect
    .poll(async () => (await prisma.subscription.findFirst({ where: { organizationId: org.orgId, deletedAt: null } }))?.subscriptionTier, { timeout: 60_000 })
    .toBe('PRO');
  // Make sure the first one is strictly older.
  await new Promise((r) => setTimeout(r, 1_100));
  const second = await subscribe();

  await expect.poll(async () => (await stripe.subscriptions.retrieve(second.id)).status, { timeout: 60_000 }).toBe('canceled');
  expect((await stripe.subscriptions.retrieve(first.id)).status).toBe('active');

  const invoice = (await stripe.invoices.list({ subscription: second.id, limit: 1 })).data[0];
  expect(invoice.amount_paid).toBe(2900);
  const payment = (await stripe.invoicePayments.list({ invoice: invoice.id!, limit: 1 })).data[0];
  const pi = payment.payment.payment_intent as string;
  await expect
    .poll(async () => (await stripe.refunds.list({ payment_intent: pi })).data.map((r) => [r.amount, r.reason, r.status]), { timeout: 30_000 })
    .toEqual([[2900, 'duplicate', 'succeeded']]);

  // Written right after the refund, so it can land a moment later.
  await expect
    .poll(async () => (await prisma.notifications.findFirst({ where: { organizationId: org.orgId }, orderBy: { createdAt: 'desc' } }))?.content, { timeout: 15_000 })
    .toContain('refunded its payment of £29.00');
});
