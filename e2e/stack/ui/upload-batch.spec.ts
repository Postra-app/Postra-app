import { expect, Page, Route, test } from '@playwright/test';
import { openComposer, watchForErrors } from './ui-helpers';

// Uploads in the composer (upstream 480ee7ee, 29478ed6, 66d9ef75, c2d35f94,
// 22f266aa). Two ways a customer lost files without a word:
// - one file of a batch failed: the uploader cleared every file, so the
//   others were saved to the library but never attached to the post;
// - a file finished while another was still uploading: the editor cleared
//   Uppy, and the one still in flight never arrived.
// The stack stores media locally, so each file is one POST /media/upload-server
// and the route below can fail or slow one file by its name.

// 1×1 transparent PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const attached = (page: Page) => page.locator('.sortable-container img');

const files = (page: Page, names: string[]) =>
  page.evaluateHandle(
    ({ names, png }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      // A distinct lastModified per name keeps Uppy from merging them.
      names.forEach((name, i) =>
        dt.items.add(new File([bytes], name, { type: 'image/png', lastModified: Date.now() + i }))
      );
      return dt;
    },
    { names, png: PNG }
  );

const drop = async (page: Page, names: string[]) => {
  const dataTransfer = await files(page, names);
  const editor = page.locator('.ProseMirror').first();
  await editor.dispatchEvent('dragenter', { dataTransfer });
  await editor.dispatchEvent('drop', { dataTransfer });
};

const paste = async (page: Page, names: string[]) => {
  const dataTransfer = await files(page, names);
  await page.locator('.ProseMirror').first().evaluate((el, clipboardData) => {
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, dataTransfer);
};

const nameOf = (route: Route) => route.request().postDataBuffer()?.toString('latin1') ?? '';

// Uppy's own log lines that these scenarios cause on purpose: the failed
// request this test makes, and its thumbnail queue noticing a finished file
// was taken out of the uploader.
const expectedNoise = (problem: string) =>
  problem.startsWith('500 POST') ||
  problem.includes('This looks like a network error') ||
  problem.includes('[ThumbnailGenerator] file was removed');

test('one file failing keeps the rest of the batch, with a warning', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForErrors(page);
  await page.route('**/media/upload-server', async (route) => {
    if (nameOf(route).includes('broken-')) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
    }
    // Still uploading when the other file fails.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return route.continue();
  });

  await openComposer(page, 'bluesky', `[stack ui] upload batch ${Date.now()}`);
  await drop(page, [`good-${Date.now()}.png`, `broken-${Date.now()}.png`]);

  await expect(attached(page)).toHaveCount(1);
  await expect(page.getByText('Some files failed to upload', { exact: false })).toBeVisible();
  expect(problems.filter((p) => !expectedNoise(p))).toEqual([]);
});

test('a file finishing first does not drop another still uploading', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForErrors(page);
  await page.route('**/media/upload-server', async (route) => {
    if (nameOf(route).includes('slow-')) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    return route.continue();
  });

  await openComposer(page, 'bluesky', `[stack ui] upload overlap ${Date.now()}`);
  await drop(page, [`slow-${Date.now()}.png`]);
  // A second upload while the first is in flight: a pasted image.
  await page.waitForTimeout(300);
  await paste(page, [`fast-${Date.now()}.png`]);

  await expect(attached(page)).toHaveCount(2, { timeout: 15_000 });
  expect(problems.filter((p) => !expectedNoise(p))).toEqual([]);
});

// E2E-06-36: a long upload (a big video picked by mistake) could not be
// stopped; the customer had to wait or close the tab.
test('E2E-06-36: a slow upload can be cancelled, and the next one still works', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForErrors(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/media/upload-server', async (route) => {
    if (nameOf(route).includes('huge-')) {
      // Never finishes on its own: only Cancel ends it.
      await held;
      return route.abort().catch(() => undefined);
    }
    return route.continue();
  });

  try {
    await openComposer(page, 'bluesky', `[stack ui] upload cancel ${Date.now()}`);
    await drop(page, [`huge-${Date.now()}.png`]);

    const cancel = page.getByRole('button', { name: 'Cancel upload' });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(cancel).toHaveCount(0);
    await expect(attached(page)).toHaveCount(0);

    // The composer is not left locked: the next file uploads and attaches.
    await drop(page, [`after-${Date.now()}.png`]);
    await expect(attached(page)).toHaveCount(1, { timeout: 15_000 });
  } finally {
    release();
  }
  expect(problems.filter((p) => !expectedNoise(p))).toEqual([]);
});
