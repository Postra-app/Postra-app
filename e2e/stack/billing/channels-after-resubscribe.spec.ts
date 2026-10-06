import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { database, throwawayOrg } from '../helpers';

// Upstream 4a6ba07f + c145f0c3: a lapsed plan drops the org to FREE and
// disables channels, and paying again never switched them back on. Postra
// plans are per platform, so FREE turns YouTube off (Starter platforms only)
// and a new Pro subscription must bring it back. Stripe TEST mode, webhooks
// through `stripe listen` (see README, `pnpm e2e:stack:billing`).

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

const tierOf = async (orgId: string) =>
  (await prisma.subscription.findFirst({ where: { organizationId: orgId, deletedAt: null }, orderBy: { createdAt: 'desc' } }))
    ?.subscriptionTier ?? 'FREE';

const disabledOf = async (orgId: string) =>
  (await prisma.integration.findMany({ where: { organizationId: orgId, deletedAt: null }, orderBy: { id: 'asc' }, select: { providerIdentifier: true, disabled: true } }))
    .filter((c) => c.disabled)
    .map((c) => c.providerIdentifier);

test('channels a lapsed plan disabled come back with a new Pro subscription', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 2, provider: 'facebook' });
  cleanup.push(() => org.remove());
  for (let i = 0; i < 2; i++) {
    const id = `stack-yt-${org.orgId}-${i}`;
    await prisma.integration.create({
      data: { id, internalId: `${id}-internal`, organizationId: org.orgId, name: `YouTube ${i}`, providerIdentifier: 'youtube', type: 'social', token: 'fake-token', profile: id },
    });
  }

  const customer = await stripe.customers.create({ email: `${org.orgId}@example.com` });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  await prisma.organization.update({ where: { id: org.orgId }, data: { paymentId: customer.id, allowTrial: false } });
  cleanup.push(() => stripe.customers.del(customer.id));
  const product = await stripe.products.create({ name: 'Resubscribe PRO' });
  const subscribe = () =>
    stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price_data: { currency: 'gbp', product: product.id, unit_amount: 2900, recurring: { interval: 'month' } } }],
      metadata: { service: 'gitroom', billing: 'PRO', period: 'MONTHLY' },
    });

  const first = await subscribe();
  await expect.poll(() => tierOf(org.orgId), { timeout: 60_000 }).toBe('PRO');
  expect(await disabledOf(org.orgId), 'all four on Pro').toEqual([]);

  // The plan lapses: FREE keeps the Starter platforms only.
  await stripe.subscriptions.cancel(first.id);
  await expect.poll(() => tierOf(org.orgId), { timeout: 60_000 }).toBe('FREE');
  await expect.poll(() => disabledOf(org.orgId), { timeout: 30_000 }).toEqual(['youtube', 'youtube']);

  // Paying again: YouTube is covered by Pro and everything fits in 6.
  await subscribe();
  await expect.poll(() => tierOf(org.orgId), { timeout: 60_000 }).toBe('PRO');
  await expect.poll(() => disabledOf(org.orgId), { timeout: 30_000 }).toEqual([]);
});
