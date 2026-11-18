import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Channel analytics: a failed request left a spinner for good (the toast
// went away), and going back to a channel within about a second showed a
// spinner that never ended, because no request went out.
test.use({ storageState: { cookies: [], origins: [] } });

test('analytics say when they could not load, and try again brings the cards', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 2, provider: 'pinterest' });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    let fail = true;
    await page.route('**/api/analytics/*', (route) =>
      fail
        ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"busy"}' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.goto('/analytics');
    const alert = page.getByRole('alert').filter({ hasText: 'Could not load analytics for this channel.' });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    fail = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByText('No analytics data yet')).toBeVisible();
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

test('going back to a channel quickly shows its analytics, not a spinner', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 2, provider: 'pinterest' });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    await page.route('**/api/analytics/*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.goto('/analytics');
    await expect(page.getByText('No analytics data yet')).toBeVisible({ timeout: 20_000 });
    const first = page.getByText('Throwaway pinterest 0', { exact: true }).first();
    const second = page.getByText('Throwaway pinterest 1', { exact: true }).first();
    await second.click();
    await page.waitForTimeout(400);
    await first.click();
    await page.waitForTimeout(400);
    await second.click();
    await expect(page.getByText('No analytics data yet')).toBeVisible({ timeout: 10_000 });
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
