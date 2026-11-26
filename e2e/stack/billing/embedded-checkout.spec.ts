import { expect, test } from '@playwright/test';
import Stripe from 'stripe';
import { database, throwawayOrg } from '../helpers';

// The paywall end to end, with nothing standing in for Stripe. The trial
// starts with one click and no card form; paying now goes through the
// embedded checkout: the real Stripe.js in a browser, a Checkout Session the backend
// opens in TEST mode, a test card, and the webhook `stripe listen` forwards.
// API 2026-10-28.endive dropped ui_mode 'custom' and payment_method_types on
// Checkout, and Stripe.js renamed initCheckout; the SDK types still took the
// old values, so only a run like this one shows the form opens and pays.
// Needs the UI layer and the sandbox keys:
// `STACK_UI=1 pnpm e2e:stack:billing` (see README).

const sk = process.env.STRIPE_SECRET_KEY || '';
test.skip(!sk.startsWith('sk_test_') || !process.env.STACK_UI, 'needs the UI layer and Stripe test-mode keys');
const stripe = new Stripe(sk);

test.use({
  baseURL: 'http://localhost:54000',
  browserName: 'chromium',
  viewport: { width: 1440, height: 900 },
  locale: 'en-GB',
  timezoneId: 'Europe/London',
  storageState: { cookies: [], origins: [] },
  trace: 'retain-on-failure',
});
test.describe.configure({ timeout: 5 * 60_000 });

const freeOrg = async (prisma: ReturnType<typeof database>) => {
  const free = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
  await prisma.organization.update({ where: { id: free.orgId }, data: { allowTrial: true, isTrailing: true } });
  return free;
};

const tierOf = async (prisma: ReturnType<typeof database>, orgId: string) =>
  (await prisma.subscription.findFirst({ where: { organizationId: orgId, deletedAt: null } }))?.subscriptionTier;

test('a new customer starts the Starter trial with one click, and no card form', async ({ page, context }) => {
  const prisma = database();
  const free = await freeOrg(prisma);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const checkouts: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/billing/embedded')) checkouts.push(r.url());
  });
  let customerId: string | undefined;
  try {
    await context.addCookies((await free.api.storageState()).cookies);
    await page.goto('/billing');

    // The trial's limits, before it starts, in numbers.
    const limits = page.getByTestId('trial-limits').filter({ visible: true }).first();
    await expect(limits).toBeVisible({ timeout: 30_000 });
    for (const limit of ['2 channels', '15 posts', '10 AI images', '1 AI video', '50 questions to the AI assistant']) {
      await expect(limits).toContainText(limit);
    }
    await expect(page.getByText('5 days free, no card needed. After the trial, Starter is £19 / month.')).toBeVisible();
    await expect(page.locator('#payment-element')).toHaveCount(0);

    await page.getByRole('button', { name: 'Start 5-day free trial' }).click();
    await page.waitForURL(/\/launches\?onboarding=true&check=/, { timeout: 60_000 });
    await expect.poll(() => tierOf(prisma, free.orgId), { timeout: 90_000 }).toBe('STANDARD');

    customerId = (await prisma.organization.findUniqueOrThrow({ where: { id: free.orgId } })).paymentId ?? undefined;
    const [subscription] = (await stripe.subscriptions.list({ customer: customerId!, status: 'all' })).data;
    expect(subscription.status).toBe('trialing');
    expect((subscription.trial_end! - subscription.trial_start!) / 86_400).toBe(5);
    expect(subscription.trial_settings?.end_behavior.missing_payment_method).toBe('cancel');
    expect(subscription.default_payment_method).toBeNull();
    // No checkout was opened: nothing asked for a card.
    expect(checkouts).toEqual([]);

    // Every page shows the trial bar.
    await page.goto('/launches');
    const bar = page.getByTestId('trial-bar');
    await expect(bar).toContainText('Free trial: 5 days left', { timeout: 30_000 });
    await expect(bar).toContainText('Channels 0 / 2');
    await expect(bar).toContainText('Posts 0 / 15');
    await expect(bar.getByRole('button', { name: 'Add a card to keep your plan' })).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    // The trial's email mark lives on the customer.
    if (customerId) await stripe.customers.del(customerId).catch(() => undefined);
    await free.remove();
    await prisma.$disconnect();
  }
});

test('a customer who would rather pay now gets the card form and the full plan', async ({ page, context }) => {
  const prisma = database();
  const free = await freeOrg(prisma);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /stripe|IntegrationError/i.test(m.text())) errors.push(m.text());
  });
  let customerId: string | undefined;
  try {
    await context.addCookies((await free.api.storageState()).cookies);
    await page.goto('/billing');
    const opened = page.waitForResponse((r) => r.url().endsWith('/billing/embedded') && r.request().method() === 'POST');
    await page.getByRole('button', { name: "Pay now instead and get your plan's full limits straight away" }).click();
    const checkout = await (await opened).json();
    expect(checkout.client_secret, JSON.stringify(checkout)).toBeTruthy();
    expect(checkout.trial).toBe(false);
    customerId = (await prisma.organization.findUniqueOrThrow({ where: { id: free.orgId } })).paymentId ?? undefined;

    const card = page.frameLocator('#payment-element iframe').first();
    await card.locator('input[name="number"]').fill('4242424242424242', { timeout: 60_000 });
    await card.locator('input[name="expiry"]').fill('12 / 34');
    await card.locator('input[name="cvc"]').fill('123');
    const postal = card.locator('input[name="postalCode"]');
    if (await postal.isVisible().catch(() => false)) await postal.fill('E17 3NU');

    await page.getByRole('checkbox').check();
    // Test mode only: Stripe.js lays its developer-tools badge over the
    // bottom of the page, on top of the pay button.
    await page
      .locator('iframe[title="Stripe developer tools frame"]')
      .evaluateAll((frames) => frames.forEach((f) => ((f as HTMLElement).style.display = 'none')));
    await page.getByRole('button', { name: /Pay/ }).click();

    await page.waitForURL(/\/launches\?onboarding=true&check=/, { timeout: 90_000 });
    await expect.poll(() => tierOf(prisma, free.orgId), { timeout: 90_000 }).toBe('STANDARD');

    const [subscription] = (await stripe.subscriptions.list({ customer: customerId!, status: 'all' })).data;
    expect(subscription.status).toBe('active');
    expect(subscription.items.data[0].price.unit_amount).toBe(1900);
    const [session] = (await stripe.checkout.sessions.list({ customer: customerId!, limit: 1 })).data;
    expect(session.ui_mode).toBe('elements');
    expect(session.status).toBe('complete');
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: free.orgId } });
    expect(org.isTrailing).toBe(false);

    expect(errors).toEqual([]);
  } finally {
    if (customerId) await stripe.customers.del(customerId).catch(() => undefined);
    await free.remove();
    await prisma.$disconnect();
  }
});
