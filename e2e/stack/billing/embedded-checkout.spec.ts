import { expect, test } from '@playwright/test';
import Stripe from 'stripe';
import { database, throwawayOrg } from '../helpers';

// The paywall's embedded checkout end to end, with nothing standing in for
// Stripe: the real Stripe.js in a browser, a Checkout Session the backend
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

test('a new customer starts the Starter trial through the embedded checkout', async ({ page, context }) => {
  const prisma = database();
  const free = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
  await prisma.organization.update({ where: { id: free.orgId }, data: { allowTrial: true } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /stripe|IntegrationError/i.test(m.text())) errors.push(m.text());
  });
  let customerId: string | undefined;
  try {
    await context.addCookies((await free.api.storageState()).cookies);
    const opened = page.waitForResponse((r) => r.url().endsWith('/billing/embedded') && r.request().method() === 'POST');
    await page.goto('/billing');
    const checkout = await (await opened).json();
    expect(checkout.client_secret, JSON.stringify(checkout)).toBeTruthy();
    expect(checkout.trial).toBe(true);
    customerId = (await prisma.organization.findUniqueOrThrow({ where: { id: free.orgId } })).paymentId ?? undefined;
    expect(customerId).toBeTruthy();

    const card = page.frameLocator('#payment-element iframe').first();
    await card.locator('input[name="number"]').fill('4242424242424242', { timeout: 60_000 });
    await card.locator('input[name="expiry"]').fill('12 / 34');
    await card.locator('input[name="cvc"]').fill('123');
    const postal = card.locator('input[name="postalCode"]');
    if (await postal.isVisible().catch(() => false)) await postal.fill('E17 3NU');

    await expect(page.getByText('Your 7-day trial is')).toBeVisible();
    await page.getByRole('checkbox').check();
    // Test mode only: Stripe.js lays its developer-tools badge over the
    // bottom of the page, on top of the pay button.
    await page
      .locator('iframe[title="Stripe developer tools frame"]')
      .evaluateAll((frames) => frames.forEach((f) => ((f as HTMLElement).style.display = 'none')));
    await page.getByRole('button', { name: /Start|Pay Now/ }).click();

    // The checkout sends the browser to the return URL once Stripe confirms.
    await page.waitForURL(/\/launches\?onboarding=true&check=/, { timeout: 90_000 });

    // The webhook wrote the plan: the organisation is on a Starter trial.
    await expect
      .poll(
        async () =>
          (await prisma.subscription.findFirst({ where: { organizationId: free.orgId, deletedAt: null } }))
            ?.subscriptionTier,
        { timeout: 90_000 }
      )
      .toBe('STANDARD');

    const [subscription] = (await stripe.subscriptions.list({ customer: customerId!, status: 'all' })).data;
    expect(subscription.status).toBe('trialing');
    expect(subscription.items.data[0].price.unit_amount).toBe(1900);

    // A trial checkout takes a card only (one trial per card fingerprint).
    const [session] = (await stripe.checkout.sessions.list({ customer: customerId!, limit: 1 })).data;
    expect(session.ui_mode).toBe('elements');
    expect(session.allowed_payment_method_types).toEqual(['card']);
    expect(session.status).toBe('complete');

    expect(errors).toEqual([]);
  } finally {
    // The card's trial marker lives on the customer; deleting it keeps the
    // next run's trial from being refused as a second one on this card.
    if (customerId) await stripe.customers.del(customerId).catch(() => undefined);
    await free.remove();
    await prisma.$disconnect();
  }
});
