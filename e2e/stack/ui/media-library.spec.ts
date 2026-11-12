import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserContext, expect, Page, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The media library as a customer sees it: with files in it. The shared
// axe and phone-width screens open /media on the seeded organisations,
// which have no files, so the tiles, the video frames and the picker window
// were never measured.

const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const MP4 = readFileSync(join(__dirname, 'fixtures/two-seconds.mp4'));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const violations = async (page: Page) => {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const result = await (window as any).axe.run(
      // Uppy's dashboard is left out, as in a11y.spec.ts.
      { exclude: [['.uppy-Dashboard']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }
    );
    return result.violations
      .filter((v: any) => v.impact === 'critical' || v.impact === 'serious')
      .map((v: any) => `${v.id} ×${v.nodes.length}: ${v.nodes[0].target.join(' ')}`);
  });
};

// Its own organisation, so files other specs upload in parallel cannot push
// these off the first page.
const withLibrary = async (
  context: BrowserContext,
  run: (names: { image: string; video: string }) => Promise<void>
) => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    const names = { image: `library-${Date.now()}.png`, video: `library-${Date.now()}.mp4` };
    const image = await owner.api.post('/media/upload-simple', {
      multipart: { file: { name: names.image, mimeType: 'image/png', buffer: PNG } },
    });
    expect(image.status(), await image.text()).toBe(201);
    const video = await owner.api.post('/media/upload-simple', {
      multipart: { file: { name: names.video, mimeType: 'video/mp4', buffer: MP4 } },
    });
    expect(video.status(), await video.text()).toBe(201);
    const videoId = (await video.json()).id;
    await expect
      .poll(async () => (await prisma.media.findUniqueOrThrow({ where: { id: videoId } })).poster, {
        timeout: 60_000,
      })
      .toBeTruthy();
    await context.addCookies((await owner.api.storageState()).cookies);
    await run(names);
  } finally {
    await owner.remove();
    await prisma.$disconnect();
  }
};

test.describe('a library with files', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('axe: /media with an image and a video; the video shows its frame', async ({ page, context }) => {
    test.setTimeout(120_000);
    await withLibrary(context, async ({ image, video }) => {
      await page.goto('/media');
      await expect(page.getByText(image)).toBeVisible();
      await expect(page.getByText(video)).toBeVisible();
      await expect(page.locator('video[poster]')).toHaveCount(1);
      await page.waitForLoadState('networkidle');
      expect(await violations(page)).toEqual([]);
    });
  });

  test('axe: the library window opened from "Choose picture"', async ({ page, context }) => {
    test.setTimeout(120_000);
    await withLibrary(context, async ({ image }) => {
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Choose picture', exact: true }).click();
      const library = page.getByRole('dialog').filter({ hasText: 'Media Library' });
      await expect(library.getByRole('checkbox', { name: image, exact: true })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await violations(page)).toEqual([]);
    });
  });

  // The delete button shows on hover (always on a phone) in the corner of a
  // tile, right next to the tile's own target. At 18 px it was under the
  // 24 px WCAG 2.5.8 minimum: axe flagged it in Firefox, where the pointer
  // happened to rest on a tile after "Choose picture" was clicked.
  test('the delete button on a file is at least 24 px, in the library and in the picker', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await withLibrary(context, async ({ image }) => {
      const big = async () => {
        // Only the hovered tile shows its button.
        const del = page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true });
        await expect(del).toBeVisible();
        const box = await del.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(24);
        expect(box?.height).toBeGreaterThanOrEqual(24);
        expect(await violations(page)).toEqual([]);
      };

      await page.goto('/media');
      await expect(page.getByText(image)).toBeVisible();
      await page.waitForLoadState('networkidle');
      // The caption belongs to the tile; the middle of the picture is the
      // Preview button.
      await page.getByText(image).hover();
      await big();

      await page.goto('/settings');
      await page.getByRole('button', { name: 'Choose picture', exact: true }).click();
      const library = page.getByRole('dialog').filter({ hasText: 'Media Library' });
      const tile = library.getByRole('checkbox', { name: image, exact: true });
      await expect(tile).toBeVisible();
      await page.waitForLoadState('networkidle');
      await tile.hover();
      await big();
    });
  });

  test.describe('at phone width', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('/media with files does not scroll sideways', async ({ page, context }) => {
      test.setTimeout(120_000);
      await withLibrary(context, async () => {
        await page.goto('/media');
        // Captions are left out on a phone; the tiles are what shows.
        await expect(page.locator('video[poster]')).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await page.evaluate(() => window.innerWidth)).toBe(390);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
      });
    });
  });
});
