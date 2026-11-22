import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The plan page had nothing that showed the product before the card form.
// It now carries a two-minute tour: a small picture that opens the film in a
// window. The film is the app's own file, plays there and stops with the
// window.
test.use({ storageState: { cookies: [], origins: [] } });

for (const [name, viewport] of [
  ['a laptop', { width: 1360, height: 694 }],
  ['a phone', { width: 390, height: 844 }],
] as const) {
  test(`the plan page opens the tour film in a window and it plays (${name})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(viewport);
    const prisma = database();
    const free = await throwawayOrg(prisma, {
      tier: 'PRO',
      totalChannels: 6,
      channels: 0,
    });
    await prisma.subscription.deleteMany({
      where: { organizationId: free.orgId },
    });
    try {
      await context.addCookies((await free.api.storageState()).cookies);
      await context.route(/js\.stripe\.com/, (route) => route.abort());
      await page.route('**/api/billing/embedded', (route) =>
        route.fulfill({
          json: { client_secret: 'cs_test_secret_x', trial: false },
        })
      );
      const films: string[] = [];
      page.on('request', (r) => {
        if (r.url().endsWith('.mp4')) films.push(r.url());
      });
      await page.goto('/billing');
      // The paywall renders its intro twice (wide and narrow layouts).
      const watch = page
        .getByRole('button', { name: /Watch the tour/ })
        .filter({ visible: true });
      await expect(watch).toHaveCount(1, { timeout: 20_000 });
      // Nothing of the film is fetched before the click.
      expect(films).toEqual([]);

      await watch.click();
      const dialog = page.getByRole('dialog', { name: 'Postra in 2 minutes' });
      const video = dialog.getByTestId('welcome-video');
      await expect(video).toBeVisible();
      // It really plays: the file loads from the app and time moves on.
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.duration), {
          timeout: 20_000,
        })
        .toBeGreaterThan(100);
      await video.evaluate((v: HTMLVideoElement) => {
        v.muted = true;
        return v.play();
      });
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
          timeout: 20_000,
        })
        .toBeGreaterThan(0.5);
      expect(
        films.some((u) => new URL(u).pathname === '/welcome/postra-welcome.mp4')
      ).toBe(true);

      // The whole film is on screen: a window wider or taller than the screen
      // hid the controls on a low laptop display.
      const box = await video.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(page.getByTestId('welcome-video')).toHaveCount(0);
    } finally {
      await free.remove();
      await prisma.$disconnect();
    }
  });
}
