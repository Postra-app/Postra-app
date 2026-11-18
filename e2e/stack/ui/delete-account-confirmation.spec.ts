import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Deleting the account (Settings, with the password) landed on the sign-in
// page with no word on whether it had worked.
test.use({ storageState: { cookies: [], origins: [] } });

test('after deleting the account the sign-in page says it was deleted', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/settings');
    await page.locator('#confirm-delete-account').fill('DELETE');
    const password = page.locator('#delete-account-password');
    if (await password.isVisible().catch(() => false)) await password.fill('Stack-tests-T-1');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page).toHaveURL(/\/auth\/login\?deleted=1/, { timeout: 20_000 });
    await expect(page.getByRole('status').filter({ hasText: 'Your account has been deleted' })).toBeVisible();
  } finally {
    await org.remove().catch(() => undefined);
    await prisma.$disconnect();
  }
});
