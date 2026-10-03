import { APIRequestContext, expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { Connection, WorkflowClient } from '@temporalio/client';
import { database, throwawayOrg } from '../helpers';

// P2b steps that need a signed-in customer (e2e/07-billing.md §7.P2b #4, #5,
// #6, #10, #11): the app's own billing endpoints against Stripe TEST mode, the
// webhook delivered by `stripe listen`, state read back from Stripe, the
// database and Temporal. Run with `pnpm e2e:stack:billing` (see README).

const sk = process.env.STRIPE_SECRET_KEY || '';
test.skip(!sk.startsWith('sk_test_'), 'needs Stripe test-mode keys');
const stripe = new Stripe(sk);
const DAY = 86_400;

let prisma: PrismaClient;
let temporal: WorkflowClient;
const cleanup: (() => Promise<unknown>)[] = [];

test.beforeAll(async () => {
  prisma = database();
  temporal = new WorkflowClient({ connection: await Connection.connect({ address: 'localhost:57233' }) });
});
test.afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  await prisma.$disconnect();
});
test.describe.configure({ mode: 'serial', timeout: 5 * 60_000 });

const PRICE = { STANDARD: 1200, PRO: 2900, ULTIMATE: 7900 } as const;
type Tier = keyof typeof PRICE;
const CHANNELS = { STANDARD: 3, PRO: 6, ULTIMATE: 12 } as const;

// A paying organisation: throwaway org + Stripe customer on a test clock with a
// card, and an active monthly subscription the webhook has written.
const payingOrg = async (tier: Tier) => {
  const org = await throwawayOrg(prisma, { tier, totalChannels: CHANNELS[tier], channels: 0 });
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
  const customer = await stripe.customers.create({ test_clock: clock.id, email: `${org.orgId}@example.com` });
  const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  await prisma.organization.update({ where: { id: org.orgId }, data: { paymentId: customer.id, allowTrial: false } });
  cleanup.push(() => org.remove(), () => stripe.testHelpers.testClocks.del(clock.id));

  const product = await stripe.products.create({ name: `P2B ${tier}` });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price_data: { currency: 'gbp', product: product.id, unit_amount: PRICE[tier], recurring: { interval: 'month' } } }],
    metadata: { service: 'gitroom', billing: tier, period: 'MONTHLY' },
  });
  await expect.poll(() => tierOf(org.orgId), { timeout: 60_000 }).toBe(tier);
  return { ...org, clock: clock.id, customer: customer.id, sub: sub.id };
};

const tierOf = async (orgId: string) =>
  (await prisma.subscription.findFirst({ where: { organizationId: orgId, deletedAt: null }, orderBy: { createdAt: 'desc' } }))
    ?.subscriptionTier ?? 'FREE';

const advance = async (clock: string, seconds: number) => {
  const c = await stripe.testHelpers.testClocks.retrieve(clock);
  await stripe.testHelpers.testClocks.advance(clock, { frozen_time: c.frozen_time + seconds });
  await expect
    .poll(async () => (await stripe.testHelpers.testClocks.retrieve(clock)).status, { timeout: 180_000, intervals: [2_000] })
    .toBe('ready');
};

const subscribe = (api: APIRequestContext, billing: Tier) =>
  api.post('/billing/subscribe', { data: { billing, period: 'MONTHLY', utm: '' } });

test('#4 upgrade Starter → Pro: the amount /billing/prorate quotes is the invoice', async () => {
  const org = await payingOrg('STANDARD');
  const quote = await (await org.api.post('/billing/prorate', { data: { billing: 'PRO', period: 'MONTHLY', utm: '' } })).json();
  expect(quote.price).toBeGreaterThan(0);

  expect((await subscribe(org.api, 'PRO')).status()).toBe(201);
  await expect.poll(() => tierOf(org.orgId), { timeout: 60_000 }).toBe('PRO');

  const invoices = await stripe.invoices.list({ customer: org.customer, limit: 5 });
  const proration = invoices.data.find((i) => i.billing_reason === 'subscription_update');
  expect(proration, 'proration invoice').toBeTruthy();
  expect(proration!.amount_paid / 100).toBe(quote.price);
  const subs = await stripe.subscriptions.list({ customer: org.customer, status: 'active' });
  expect(subs.data, 'still one subscription').toHaveLength(1);
});

test('#5 #11 downgrade Business → Starter: what switches off, and a member keeps their other organisation', async () => {
  const org = await payingOrg('ULTIMATE');
  const providers = ['facebook', 'instagram', 'linkedin', 'youtube', 'threads', 'tiktok', 'x', 'discord', 'mastodon', 'bluesky', 'telegram', 'linkedin-page'];
  for (const [i, p] of providers.entries()) {
    await prisma.integration.create({
      data: { createdAt: new Date(Date.now() - (100 - i) * 60_000), id: `p2b-${org.orgId}-${i}`, internalId: `p2b-${org.orgId}-${i}`, organizationId: org.orgId, name: `P2B ${p}`, providerIdentifier: p, type: 'social', token: 'fake', profile: p },
    });
  }
  // Four more members (Business = 5 seats); the second one also belongs to
  // another organisation, which a downgrade here must not touch.
  const other = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  cleanup.push(() => other.remove());
  const members: string[] = [];
  for (let i = 0; i < 4; i++) {
    const u = await prisma.user.create({
      data: { email: `p2b-${org.orgId}-${i}@example.com`, password: 'x', providerName: 'LOCAL', timezone: 0, activated: true, createdAt: new Date(Date.now() - (10 - i) * 60_000) },
    });
    members.push(u.id);
    cleanup.push(() => prisma.user.delete({ where: { id: u.id } }));
    await prisma.userOrganization.create({ data: { userId: u.id, organizationId: org.orgId, role: 'USER', createdAt: new Date(Date.now() - (10 - i) * 60_000) } });
  }
  await prisma.userOrganization.create({ data: { userId: members[1], organizationId: other.orgId, role: 'USER' } });

  expect((await subscribe(org.api, 'STANDARD')).status()).toBe(201);
  await expect.poll(() => tierOf(org.orgId), { timeout: 60_000 }).toBe('STANDARD');
  await expect
    .poll(async () => (await prisma.userOrganization.count({ where: { organizationId: org.orgId, disabled: false } })), { timeout: 30_000 })
    .toBe(1);

  const channels = await prisma.integration.findMany({ where: { organizationId: org.orgId, deletedAt: null }, select: { providerIdentifier: true, disabled: true } });
  const active = channels.filter((c) => !c.disabled).map((c) => c.providerIdentifier);
  test.info().annotations.push({ type: 'still active on Starter', description: active.join(', ') });
  expect(active.length).toBeLessThanOrEqual(3);
  for (const p of ['x', 'discord', 'youtube', 'threads', 'linkedin-page']) {
    expect(active, `${p} is not a Starter platform`).not.toContain(p);
  }
  // Of the Starter platforms, the three connected first stay.
  expect(active.sort()).toEqual(['facebook', 'instagram', 'linkedin']);
  const owner = await prisma.userOrganization.findFirst({ where: { organizationId: org.orgId, role: 'SUPERADMIN' } });
  expect(owner?.disabled, 'the owner keeps their seat').toBe(false);
  const elsewhere = await prisma.userOrganization.findFirst({ where: { userId: members[1], organizationId: other.orgId } });
  expect(elsewhere?.disabled, 'membership in the other organisation untouched').toBe(false);

  const credit = (await stripe.invoices.list({ customer: org.customer, limit: 3 })).data.find((i) => i.billing_reason === 'subscription_update');
  test.info().annotations.push({ type: 'downgrade invoice', description: `total ${credit?.total} ${credit?.currency}` });
});

test('#6 #10 cancel → two emails → reactivate → cancel → period ends → FREE → re-purchase offers no trial', async () => {
  const org = await payingOrg('PRO');
  const since = new Date();

  const cancelled = await (await org.api.post('/billing/cancel', { data: { feedback: 'Testing the cancellation path end to end' } })).json();
  expect(cancelled.cancel_at).toBeTruthy();
  expect((await stripe.subscriptions.retrieve(org.sub)).cancel_at_period_end).toBe(true);
  await expect.poll(async () => !!(await prisma.subscription.findFirst({ where: { organizationId: org.orgId, deletedAt: null } }))?.cancelAt, { timeout: 30_000 }).toBe(true);

  const owner = await prisma.user.findFirst({ where: { organizations: { some: { organizationId: org.orgId, role: 'SUPERADMIN' } } } });
  const subjects = await emailsSince(since);
  expect(subjects).toContainEqual({ to: owner!.email, subject: 'Your Postra subscription is cancelled' });
  expect(subjects.some((s) => s.subject === 'Subscription Cancelled')).toBe(true);

  await org.api.post('/billing/cancel', { data: { feedback: 'Changed my mind about it, keep it' } });
  expect((await stripe.subscriptions.retrieve(org.sub)).cancel_at_period_end, 'reactivated').toBe(false);
  await org.api.post('/billing/cancel', { data: { feedback: 'Testing the cancellation path end to end' } });

  // #10: the portal opens for this customer; the invoice is GBP with no tax.
  const portal = await (await org.api.get('/billing/portal')).json();
  expect(portal.portal).toMatch(/^https:\/\/billing\.stripe\.com\//);
  const invoice = (await stripe.invoices.list({ customer: org.customer, limit: 1 })).data[0];
  expect(invoice.currency).toBe('gbp');
  expect(invoice.total_taxes?.reduce((s, t) => s + t.amount, 0) ?? 0).toBe(0);
  expect(invoice.invoice_pdf).toMatch(/^https:/);

  await advance(org.clock, 32 * DAY);
  await expect.poll(() => tierOf(org.orgId), { timeout: 120_000, intervals: [3_000] }).toBe('FREE');

  const again = await (await subscribe(org.api, 'PRO')).json();
  expect(again.url, 'back on FREE, buying again goes to checkout').toMatch(/^https:\/\/checkout\.stripe\.com\//);
  const orgRow = await prisma.organization.findUnique({ where: { id: org.orgId } });
  expect(orgRow?.allowTrial, 'one trial per organisation').toBe(false);
  const session = (await stripe.checkout.sessions.list({ customer: org.customer, limit: 1 })).data[0];
  expect(session.mode).toBe('subscription');
});

// Emails go out through the long-running `send_email` workflow; every
// sendEmail is a signal carrying { to, subject }.
const emailsSince = async (since: Date) => {
  const history = await temporal.getHandle('send_email').fetchHistory();
  const out: { to: string; subject: string }[] = [];
  for (const e of history.events ?? []) {
    const sig = e.workflowExecutionSignaledEventAttributes;
    const at = e.eventTime?.seconds ? Number(e.eventTime.seconds) * 1000 : 0;
    if (!sig || sig.signalName !== 'sendEmail' || at < since.getTime() - 5_000) continue;
    const payload = sig.input?.payloads?.[0]?.data;
    if (!payload) continue;
    const { to, subject } = JSON.parse(Buffer.from(payload).toString());
    out.push({ to, subject });
  }
  return out;
};

// P2 (Plan/lunchdayfinal.md, queue 3): the admin refund path, which the live
// card test does not exercise (K. keeps that payment). A Postra staff user
// lists the organisation's charges and refunds the paid one; a charge that
// belongs to another customer is refused even when its id is sent.
test('a superadmin refunds a paid charge; another customer\'s charge is refused', async () => {
  const org = await payingOrg('STANDARD');
  const other = await payingOrg('STANDARD');

  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  cleanup.push(() => staff.remove());
  const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
  await prisma.user.update({ where: { id: staffUser.userId }, data: { isSuperAdmin: true } });
  // The auth context is cached for a short while; wait for the flag to land.
  await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);

  const listed = await staff.api.get(`/admin/charges?organizationId=${org.orgId}`);
  expect(listed.status(), await listed.text()).toBe(200);
  const charges: { id: string; amount: number }[] = (await listed.json()).charges;
  const paid = charges.find((c) => c.amount === PRICE.STANDARD);
  expect(paid, 'the first invoice was charged').toBeTruthy();
  const foreign = (await stripe.charges.list({ customer: other.customer, limit: 1 })).data[0];

  const res = await staff.api.post('/admin/refund-charges', {
    data: { organizationId: org.orgId, chargeIds: [paid!.id, foreign.id] },
  });
  expect(res.status(), await res.text()).toBe(201);
  expect(await res.json()).toEqual({ refunded: [paid!.id], failed: [foreign.id] });

  expect((await stripe.charges.retrieve(paid!.id)).refunded).toBe(true);
  expect((await stripe.charges.retrieve(foreign.id)).refunded).toBe(false);
  const audit = await prisma.auditLog.findFirst({ where: { action: 'billing.refund', organizationId: org.orgId } });
  expect(audit, 'the refund is in the audit trail').toBeTruthy();

  // An organisation owner (not staff) cannot reach the route at all.
  expect((await org.api.post('/admin/refund-charges', { data: { organizationId: org.orgId, chargeIds: [paid!.id] } })).status()).toBe(403);
});
