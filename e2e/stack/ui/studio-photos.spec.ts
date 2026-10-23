import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { watchForErrors } from './ui-helpers';

// Studio → Photos: a library photo in, a retouched copy out, from the tab
// itself (Plan/photo-retouch.md). The fake OpenAI answers the vision call
// with ones, so the photo gets brighter and warmer within the level.

test.use({ viewport: { width: 1440, height: 900 } });

const photo = async () => {
  const w = 320;
  const h = 240;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const v = 10 + Math.round((x / (w - 1)) * 150);
      raw[i] = Math.round(v * 0.8);
      raw[i + 1] = v;
      raw[i + 2] = Math.min(255, Math.round(v * 1.25));
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
};

test('the Photos tab retouches a library photo and the library gets the copy', async ({ page }) => {
  const problems = watchForErrors(page);
  const name = `studio-photos-${Date.now()}.jpg`;
  const upload = await page.request.post('/api/media/upload-simple', {
    multipart: { file: { name, mimeType: 'image/jpeg', buffer: await photo() } },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const { id } = await upload.json();

  // the library's "Retouch" lands on the Photos tab with the photo loaded
  await page.goto(`/studio?mode=photo&mediaId=${id}`);
  await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('retouch-item')).toHaveCount(1);
  await expect(page.getByText('Ready to retouch')).toBeVisible();

  await page.getByRole('radio', { name: 'Black & white' }).click();
  await page.getByRole('button', { name: 'Retouch all', exact: true }).click();
  const item = page.getByTestId('retouch-item');
  await expect(item).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  // the one-line summary and the level badge
  await expect(item.getByText('Black & white')).toBeVisible();
  await expect(page.getByText('Every retouched photo is already in your Media library.')).toBeVisible();

  // hold to compare shows the original
  const picture = item.locator('img');
  const retouched = await picture.getAttribute('src');
  await picture.dispatchEvent('pointerdown');
  await expect(item.getByText('Original')).toBeVisible();
  expect(await picture.getAttribute('src')).not.toBe(retouched);
  await picture.dispatchEvent('pointerup');

  // the copy is a library file next to the untouched source
  const list = await page.request.get('/api/media?page=1');
  const results = ((await list.json()).results ?? []) as { id: string; originalName: string }[];
  expect(results.some((m) => m.id === id)).toBe(true);
  expect(results.some((m) => m.originalName === name.replace('.jpg', ' (retouched, black and white).jpg'))).toBe(true);

  // the tab is a sibling of Graphics and Video
  for (const tab of ['Graphics', 'Video', 'Photos']) {
    await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
  }
  expect(problems).toEqual([]);
});
