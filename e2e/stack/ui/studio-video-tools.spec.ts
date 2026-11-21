import { Download, expect, Page, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import sharp from 'sharp';
import { watchForErrors } from './ui-helpers';

// Studio → Video: the goals screen leads to each tool, Photos → video makes a
// clip as long as the seconds per photo say, and Cancel stops a render without
// leaving a clip or an upload behind. Chromium only: WebKit's encoder is
// covered by studio-video-export.spec.ts.

test.use({ viewport: { width: 1440, height: 900 } });

const photos = (count: number) =>
  Promise.all(
    Array.from({ length: count }, async (_, i) => ({
      name: `slide-${i}.jpg`,
      mimeType: 'image/jpeg',
      buffer: await sharp({
        create: { width: 800, height: 800, channels: 3, background: { r: 40 + i * 30, g: 120, b: 200 - i * 20 } },
      })
        .jpeg()
        .toBuffer(),
    }))
  );

const slideshow = async (page: Page, count: number) => {
  await page.goto('/studio?mode=video');
  await page.getByRole('button', { name: /^Photos → Reels/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photos (0/10)' }).click({ timeout: 30_000 });
  await (await chooser).setFiles(await photos(count));
  await expect(page.getByRole('button', { name: `Add photos (${count}/10)` })).toBeVisible();
  // The smallest frame keeps the render short.
  await page.locator('select:has(option[value="square-1-1"])').selectOption('square-1-1');
};

const seconds = (page: Page) => page.locator('select:has(option[value="1.5"])');
const build = (page: Page) => page.getByRole('button', { name: 'Build video from photos' });

const duration = async (download: Download) => {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const input = new Input({ source: new BufferSource(Buffer.concat(chunks)), formats: ALL_FORMATS });
  return input.computeDuration();
};

test('the goals screen opens each tool', async ({ page }) => {
  const problems = watchForErrors(page);
  // Stock B-roll searches as it opens; the stack has no Pixabay.
  await page.route('**/api/media/pixabay-videos?*', (route) => route.fulfill({ json: { hits: [] } }));
  await page.goto('/studio?mode=video');
  const goals = page.getByText('What do you want to make?', { exact: true });
  await expect(goals).toBeVisible({ timeout: 30_000 });

  const cases: [RegExp, () => Promise<void>, boolean][] = [
    [/^Photos → Reels/, () => expect(page.getByRole('button', { name: 'Add photos (0/10)' })).toBeVisible(), false],
    [/^Trim a video/, () => expect(page.getByText('Choose a video file to get started.')).toBeVisible(), true],
    [/^Add captions/, () => expect(page.getByText('Choose a video to caption.')).toBeVisible(), true],
    [/^Text on video/, () => expect(page.getByPlaceholder('Text on video')).toBeVisible(), false],
    [
      /^Find stock B-roll/,
      () => expect(page.getByPlaceholder('e.g. nature timelapse, city street, ocean')).toBeVisible(),
      false,
    ],
    [
      /^Resize for platforms/,
      () => expect(page.getByText('Load a video first (From disk / From library) to pick formats.')).toBeVisible(),
      false,
    ],
  ];
  for (const [card, shows, asksForClip] of cases) {
    // Trim and captions need a clip: they open the file picker at once.
    const chooser = asksForClip ? page.waitForEvent('filechooser', { timeout: 5_000 }) : null;
    await page.getByRole('button', { name: card }).click();
    await expect(goals).toBeHidden();
    await shows();
    if (chooser) await chooser;
    await page.getByTitle('What do you want to make? - back to goals').click();
    await expect(goals).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('Photos → video: Seconds/photo sets how long the clip is', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watchForErrors(page);
  await slideshow(page, 2);
  for (const [value, expected] of [
    ['1.5', 3],
    ['4', 8],
  ] as const) {
    await seconds(page).selectOption(value);
    await build(page).click();
    const link = page.getByRole('link', { name: 'Download', exact: true });
    await expect(link).toBeVisible({ timeout: 120_000 });
    const download = page.waitForEvent('download');
    await link.click();
    expect(await duration(await download)).toBeCloseTo(expected, 0);
  }
  expect(problems).toEqual([]);
});

test('Photos → video: Cancel stops the render and leaves no clip and no upload', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchForErrors(page);
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/media')) uploads.push(r.url());
  });
  await slideshow(page, 10);
  await seconds(page).selectOption('4');
  await build(page).click();
  await expect(page.getByRole('button', { name: /^Building video…/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(build(page)).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  // Long enough for a render that kept going in the background to land.
  await page.waitForTimeout(5_000);
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save to library' })).toHaveCount(0);
  expect(uploads).toEqual([]);
  expect(problems).toEqual([]);
});
