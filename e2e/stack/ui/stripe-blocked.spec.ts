import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// An ad blocker stops Stripe.js: the paywall used to wait forever on a
// spinner behind an unhandled rejection; now it says what to do (upstream
// cdaf61d6). An organisation without a plan sees the paywall.
test.use({ storageState: { cookies: [], origins: [] } });

test('Stripe.js blocked: the paywall explains instead of spinning', async ({ page, context }) => {
  const prisma = database();
  const free = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
  try {
    await context.addCookies((await free.api.storageState()).cookies);
    await context.route(/js\.stripe\.com/, (route) => route.abort());
    await page.goto('/billing');
    await expect(page.getByText('The payment form could not be loaded')).toBeVisible({ timeout: 20_000 });
  } finally {
    await free.remove();
    await prisma.$disconnect();
  }
});
