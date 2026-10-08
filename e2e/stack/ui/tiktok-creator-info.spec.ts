import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// E2E-08-63: when TikTok's creator info could not be read (the backend answers
// `false` once a token refresh fails), the composer kept saying "Loading your
// TikTok settings…" over an empty privacy list and the post could not be saved.
test.use({ storageState: { cookies: [], origins: [] } });

test('E2E-08-63: the composer says when TikTok settings could not be loaded', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 1, provider: 'tiktok' });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    await page.route('**/api/integrations/function', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: 'false' })
    );
    await page.goto('/launches');
    await page.getByRole('button', { name: 'Create Post' }).click();
    await page.getByRole('img', { name: 'tiktok', exact: true }).first().click();
    // The channel's own tab, then its settings panel.
    await page.getByRole('button', { name: 'Throwaway tiktok 0', exact: true }).click();
    await page.getByText('Throwaway tiktok 0 Settings').click();
    const privacy = page.getByRole('combobox', { name: 'Who can see this video?' });
    await expect(privacy).toContainText("Couldn't load your TikTok settings");
    await expect(privacy).not.toContainText('Loading your TikTok settings');
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
