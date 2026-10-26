import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// 18 X: the paywall promised "Pay NOTHING for the first 7-days" from the
// organisation's offer while the checkout, for an email that already had a
// trial, charged £19 at once. The page now promises free days only when the
// checkout it shows has them.
test.use({ storageState: { cookies: [], origins: [] } });

for (const trial of [true, false]) {
  test(`the paywall promises a free trial only when the checkout has one (trial: ${trial})`, async ({ page, context }) => {
    const prisma = database();
    const free = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
    await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
    await prisma.organization.update({ where: { id: free.orgId }, data: { allowTrial: true } });
    try {
      await context.addCookies((await free.api.storageState()).cookies);
      await context.route(/js\.stripe\.com/, (route) => route.abort());
      await page.route('**/api/user/self', async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: { ...(await res.json()), allowTrial: true } });
      });
      await page.route('**/api/billing/embedded', (route) =>
        route.fulfill({ json: { client_secret: 'cs_test_secret_x', trial } })
      );
      await page.goto('/billing');
      // The paywall renders its intro twice (wide and narrow layouts).
      await expect(page.getByText('Create a month of content').first()).toBeVisible({ timeout: 20_000 });
      const promise = page.getByText('Pay nothing for the first 7 days');
      if (trial) {
        await expect(promise.filter({ visible: true })).toHaveCount(1);
      } else {
        await expect(page.getByText('The payment form could not be loaded').first()).toBeVisible({ timeout: 20_000 });
        await expect(promise).toHaveCount(0);
      }
    } finally {
      await free.remove();
      await prisma.$disconnect();
    }
  });
}
