import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// 18 X (Sentry): the paid-but-not-yet-confirmed organisation reloaded the
// paywall, `/billing/embedded` answered 409 and the page still handed the
// error body to Stripe. `initCheckout()` threw "Missing value for
// initCheckout(): options.clientSecret" and no form appeared. Any answer
// without a client secret (409, 429, 500) now shows a message instead.
test.use({ storageState: { cookies: [], origins: [] } });

// Stands in for js.stripe.com: like the real one, initCheckout() throws
// without a client secret, and a real secret loads a form that never resolves.
const fakeStripe = `
window.Stripe = function () {
  return {
    _registerWrapper: function () {},
    registerAppInfo: function () {},
    // what CheckoutProvider checks before it accepts the instance
    elements: function () {},
    createToken: function () {},
    createPaymentMethod: function () {},
    confirmCardPayment: function () {},
    initCheckout: function (options) {
      if (!options || !options.clientSecret) {
        throw new Error('IntegrationError: Missing value for initCheckout(): options.clientSecret');
      }
      return { loadActions: function () { return new Promise(function () {}); }, on: function () {} };
    },
  };
};`;

const cases = [
  {
    status: 409,
    body: { statusCode: 409, message: 'This organization already has a subscription. Change the plan from the billing page instead.' },
    text: 'Your subscription is already set up. Reload the page in a few seconds to see your plan.',
  },
  {
    status: 500,
    body: { statusCode: 500, message: 'Internal server error' },
    text: 'The payment form could not be loaded. Reload the page, or email hello@postra.co.uk if it keeps happening.',
  },
];

for (const c of cases) {
  test(`the paywall explains a checkout that could not start (${c.status})`, async ({ page, context }) => {
    const prisma = database();
    const free = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
    await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.text().includes('clientSecret')) errors.push(m.text());
    });
    try {
      await context.addCookies((await free.api.storageState()).cookies);
      await context.route(/js\.stripe\.com/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: fakeStripe })
      );
      await page.route('**/api/billing/embedded', (route) =>
        route.fulfill({ status: c.status, json: c.body })
      );
      await page.goto('/billing');
      await expect(page.getByText('Create a month of content').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(c.text)).toBeVisible({ timeout: 20_000 });
      expect(errors).toEqual([]);
    } finally {
      await free.remove();
      await prisma.$disconnect();
    }
  });
}
