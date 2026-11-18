import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The welcome window closed with its cross came back on refresh:
// `?onboarding=true` stayed in the address.
test.use({ storageState: { cookies: [], origins: [] } });

test('the welcome window closed with the cross stays closed after a refresh', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/launches?onboarding=true');
    const close = page.locator('button.mantine-Modal-close').first();
    await expect(close).toBeVisible({ timeout: 20_000 });
    await close.click();
    // The window asks before closing (askClose).
    const yes = page.getByRole('button', { name: /Yes/ });
    if (await yes.isVisible().catch(() => false)) await yes.click();
    await expect(page).not.toHaveURL(/onboarding=true/);
    await page.reload();
    await expect(page.getByText('Connect your channels')).toHaveCount(0);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
