import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openComposer } from './ui-helpers';

// A video's custom thumbnail, picked from a frame in Media Settings, under
// production's Content-Security-Policy (the stack proxy serves nginx.conf's).
// The frame was kept as a blob: URL and fetched back before the upload;
// connect-src allows no blob:, so in production Save Changes uploaded nothing.

test.use({ viewport: { width: 1440, height: 900 } });

const video = readFileSync(`${__dirname}/fixtures/two-seconds.mp4`);

test('a frame picked as the video thumbnail is uploaded on Save Changes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    (window as any).__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__violations.push(`${e.effectiveDirective} ${e.blockedURI}`)
    );
  });
  // The editor streams the video through the backend, which only fetches
  // Postra's CDN over https; the stack keeps media on localhost.
  await page.route('**/api/public/stream?**', (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: video })
  );

  await openComposer(page, 'bluesky', 'A video with its own thumbnail');
  const dataTransfer = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'clip.mp4', { type: 'video/mp4' }));
    return dt;
  }, video.toString('base64'));
  const prose = page.locator('.ProseMirror').first();
  await prose.dispatchEvent('dragenter', { dataTransfer });
  await prose.dispatchEvent('drop', { dataTransfer });

  const tile = page.locator('.sortable-container > div').first();
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.hover();
  await tile.getByRole('button', { name: 'Media Settings' }).click();

  await page.getByRole('button', { name: 'Create Thumbnail' }).click();
  await page.getByRole('button', { name: 'Select This Frame' }).click({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Edit Thumbnail' })).toBeVisible();

  const uploaded = page.waitForResponse(
    (res) => res.url().includes('/media/upload-simple') && res.request().method() === 'POST',
    { timeout: 15_000 }
  );
  await page.getByRole('button', { name: 'Save Changes' }).click();
  expect((await uploaded).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);

  const violations: string[] = await page.evaluate(() => (window as any).__violations);
  expect(violations.filter((v) => v.startsWith('connect-src'))).toEqual([]);
});
