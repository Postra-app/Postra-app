import { readFileSync } from 'fs';
import { expect, Page, test } from '@playwright/test';
import { watchForErrors } from './ui-helpers';

// Studio → Video under the enforced Content-Security-Policy (the stack proxy
// serves nginx.conf's). The clip is a two-second WebM with a 440 Hz tone:
// Playwright's Chromium decodes VP8 and Opus, not H.264.

test.use({ viewport: { width: 1440, height: 900 } });

const clip = readFileSync(`${__dirname}/fixtures/tone-two-seconds.webm`);

const recordViolations = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__violations.push(`${e.effectiveDirective} ${e.blockedURI}`)
    );
  });
  return () => page.evaluate(() => (window as any).__violations as string[]);
};

const loadClip = async (page: Page) => {
  await page.goto('/studio?mode=video');
  await page
    .locator('input[type="file"][accept="video/*"]')
    .first()
    .setInputFiles({ name: 'tone.webm', mimeType: 'video/webm', buffer: clip });
  await page.getByRole('button', { name: 'Trim', exact: true }).click();
  // The readout exists before and after the keyboard sliders came in.
  await expect(page.getByText(/^End: [12]\.\d\ds$/)).toBeVisible({ timeout: 30_000 });
  return page.getByRole('slider', { name: 'Start' });
};

// Share of the waveform's pixels that are painted. A clip with sound fills its
// bars; the flat line drawn when the audio could not be read paints next to
// nothing.
const waveformInk = (page: Page) =>
  page.evaluate(() => {
    const readout = [...document.querySelectorAll('span')].find((e) =>
      e.textContent?.startsWith('Start: ')
    );
    const wave = readout?.parentElement?.previousElementSibling;
    const root = (wave?.firstElementChild as HTMLElement | null)?.shadowRoot;
    let painted = 0;
    let total = 0;
    for (const canvas of root ? [...root.querySelectorAll('canvas')] : []) {
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.width || !canvas.height) continue;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) {
        total += 1;
        if (data[i] > 0) painted += 1;
      }
    }
    return total ? painted / total : 0;
  });

// WaveSurfer was handed the clip's blob: URL and fetch()ed it. connect-src has
// no blob:, so under the policy every clip fell back to a flat line and the
// waveform Trim is built around never showed.
test('Trim draws the clip’s waveform without breaking the policy', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForErrors(page);
  const violations = await recordViolations(page);
  await loadClip(page);
  await expect.poll(() => waveformInk(page), { timeout: 15_000 }).toBeGreaterThan(0.2);
  expect(await violations()).toEqual([]);
  expect(problems).toEqual([]);
});

// The trim edges could only be dragged with a mouse.
test('Trim edges move from the keyboard', async ({ page }) => {
  test.setTimeout(60_000);
  const start = await loadClip(page);
  const end = page.getByRole('slider', { name: 'End' });
  const length = Number(await end.getAttribute('aria-valuenow'));
  expect(length).toBeGreaterThan(1.5);

  await start.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(start).toHaveAttribute('aria-valuenow', '1.2');
  await page.keyboard.press('Home');
  await expect(start).toHaveAttribute('aria-valuenow', '0');

  await end.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(end).toHaveAttribute('aria-valuenow', String(Number((length - 0.1).toFixed(2))));
  await expect(page.getByText(/^Trimmed: /)).toContainText(`Trimmed: ${(length - 0.1).toFixed(2)}s`);
});

// After "From library" or a restored session nothing said which clip Trim,
// Formats and Captions were working on.
test('the clip being edited is named above the tools', async ({ page }) => {
  test.setTimeout(60_000);
  await loadClip(page);
  await expect(page.getByTitle('tone.webm')).toBeVisible();
});

// On the Studio page there is no window to close: the button did nothing.
test('a browser without WebCodecs is told so on the Studio page, without a dead button', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true });
  });
  await page.goto('/studio?mode=video');
  await expect(page.getByText('Your browser does not support video editing')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
});

// Photos → video could only add photos from disk, and the header's "From
// library" (it loads a video for Trim) opened an empty list of videos there,
// with the photos sitting in Media.
test('Photos → video takes photos from the library', { tag: '@safari' }, async ({ page }) => {
  test.setTimeout(60_000);
  const original = `slideshow-${Date.now()}.png`;
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const up = await page.request.post('/api/media/upload-simple', {
    multipart: { file: { name: original, mimeType: 'image/png', buffer: PNG } },
  });
  expect(up.status(), await up.text()).toBe(201);

  await page.goto('/studio?mode=video');
  await page.getByRole('button', { name: /Photos → video/ }).first().click();
  await expect(page.getByRole('button', { name: /Add photos \(0\/10\)/ })).toBeVisible({ timeout: 30_000 });
  // Only the slideshow's own sources: the video ones are not offered here.
  await expect(page.getByRole('button', { name: 'From disk', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'From library', exact: true }).click();
  await page.getByRole('checkbox', { name: original, exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Add selected media', exact: true }).click();
  await expect(page.getByRole('button', { name: /Add photos \(1\/10\)/ })).toBeVisible({ timeout: 15_000 });
});
