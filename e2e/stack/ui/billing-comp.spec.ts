import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// A plan Postra gave (an influencer's comp) has no Stripe subscription:
// "Cancel Subscription" answered with nothing. Billing now says where the
// plan comes from and when it ends, and offers nothing to cancel.
test.use({ storageState: { cookies: [], origins: [] } });

test('a comped plan says it was given by Postra and when it ends, with nothing to cancel', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 8, channels: 0 });
  try {
    await prisma.subscription.updateMany({
      where: { organizationId: org.orgId },
      data: { compReason: 'influencer', compEndsAt: new Date('2027-02-18T00:00:00Z') },
    });
    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/billing');
    await expect(page.getByTestId('billing-comp')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Postra gave you this plan.')).toBeVisible();
    await expect(page.getByText('It ends on 18 February 2027.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Cancel Subscription/i })).toHaveCount(0);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
