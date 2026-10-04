import { expect, test } from '@playwright/test';
import { database, stateFile, throwawayOrg } from '../helpers';

// The bell: an empty list says so, unread notifications are announced (the
// red dot alone is invisible to a screen reader), opening reads them, and on
// a phone the list fits the screen.
test.describe('a fresh organisation', () => {
  // No notifications from other specs, and its own read marker.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the bell: empty list, unread count, read after opening', async ({
    page,
    context,
  }) => {
    const prisma = database();
    const org = await throwawayOrg(prisma, {
      tier: 'PRO',
      totalChannels: 6,
      channels: 0,
    });
    try {
      await context.addCookies((await org.api.storageState()).cookies);
      await page.goto('/launches');
      const bell = page.getByRole('button', {
        name: 'Notifications',
        exact: true,
      });
      await bell.click();
      await expect(
        page.locator('#notification-popup').getByText('No notifications')
      ).toBeVisible();
      await bell.click();

      await prisma.notifications.createMany({
        data: [
          {
            organizationId: org.orgId,
            content: 'Your post to Bluesky was published.',
          },
          {
            organizationId: org.orgId,
            content: 'Your post to Mastodon failed: rate limited.',
          },
        ],
      });
      await page.reload();
      const unread = page.getByRole('button', {
        name: 'Notifications, 2 unread',
      });
      await expect(unread).toBeVisible();
      await unread.click();
      const popup = page.locator('#notification-popup');
      await expect(
        popup.getByText('Your post to Bluesky was published.')
      ).toBeVisible();
      await expect(
        popup.getByText('Your post to Mastodon failed: rate limited.')
      ).toBeVisible();

      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Notifications', exact: true })
      ).toBeVisible();
    } finally {
      await org.remove();
      await prisma.$disconnect();
    }
  });
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    storageState: stateFile('a'),
  });

  test('the notification list and an announcement fit the screen', async ({
    page,
  }) => {
    await page.route('**/api/announcements', (route) =>
      route.fulfill({
        json: [
          {
            id: 'stack-announcement-phone',
            title:
              'Planned maintenance tonight: publishing pauses for ten minutes at 23:00 UK time',
            description: 'Posts due in that window go out right after.',
            color: 'WARNING',
            createdAt: new Date().toISOString(),
          },
        ],
      })
    );
    await page.goto('/launches');
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);

    const banner = page.getByRole('button', {
      name: /Planned maintenance tonight/,
    });
    await expect(banner).toBeVisible();
    const b = (await banner.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);

    await page.getByRole('button', { name: /^Notifications/ }).click();
    const popup = page.locator('#notification-popup');
    await expect(popup).toBeVisible();
    await page.waitForTimeout(400); // fade-in animation
    const p = (await popup.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
  });
});
