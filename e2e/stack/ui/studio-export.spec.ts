import { expect, Page, test } from '@playwright/test';
import { openComposer, watchForErrors } from './ui-helpers';

// Every way a design leaves Studio, under production's Content-Security-Policy
// (the stack proxy serves nginx.conf's). The export turned the canvas into a
// data: URL and fetched it back as a Blob; connect-src has no data:, so in
// production each of these failed with "Export failed" while the stack, which
// had no policy, passed.

test.use({ viewport: { width: 1440, height: 900 } });

const recordViolations = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__violations.push(`${e.effectiveDirective} ${e.blockedURI}`)
    );
  });
  return () => page.evaluate(() => (window as any).__violations as string[]);
};

const uploads = (page: Page) => {
  const seen: number[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/media/upload-simple') && res.request().method() === 'POST') {
      seen.push(res.status());
    }
  });
  return seen;
};

test('Studio → Save to library uploads the design', async ({ page }) => {
  const problems = watchForErrors(page);
  const violations = await recordViolations(page);
  const sent = uploads(page);

  await page.goto('/studio');
  await page.getByText('Blank canvas').click();
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Save to library/ }).click();

  await expect(page.getByText('Saved to media library')).toBeVisible({ timeout: 20_000 });
  expect(sent).toEqual([201]);
  expect(await violations()).toEqual([]);
  expect(problems).toEqual([]);
});

test('Studio → All formats → Add all to post attaches every format', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchForErrors(page);
  const violations = await recordViolations(page);
  const sent = uploads(page);

  await openComposer(page, 'bluesky', 'Every format from Studio');
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await editor.getByRole('button', { name: 'Studio', exact: true }).click();
  await page.getByText('Blank canvas').click();
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /All formats/ }).click();

  const addAll = page.getByRole('button', { name: 'Add all to post' });
  await expect(addAll).toBeEnabled({ timeout: 45_000 });

  // The ZIP holds one PNG per format. The ZIP library used to come with Node
  // polyfills whose generator probe calls Function(), which the policy
  // refuses: an eval violation on every page that loaded the chunk.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download all/ }).click();
  const zip = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of zip) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.toString('latin1').match(/\.png/g)?.length).toBeGreaterThanOrEqual(7);

  await addAll.click();

  // Studio closes and the post carries the pictures.
  await expect(addAll).toHaveCount(0, { timeout: 45_000 });
  expect(sent.length).toBeGreaterThan(1);
  expect(sent.every((s) => s === 201)).toBe(true);
  await expect(editor.locator('img[src*="/uploads/"]').first()).toBeVisible();
  expect(await violations()).toEqual([]);
  expect(problems).toEqual([]);
});

test('composer → Studio → Use in post leaves no policy violation', async ({ page }) => {
  const violations = await recordViolations(page);
  const sent = uploads(page);

  await openComposer(page, 'bluesky', 'One graphic from Studio');
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await editor.getByRole('button', { name: 'Studio', exact: true }).click();
  await page.getByText('Blank canvas').click();
  await page.getByRole('button', { name: 'Use in post' }).click();

  await expect(page.getByRole('button', { name: 'Use in post' })).toHaveCount(0, { timeout: 20_000 });
  expect(sent).toEqual([201]);
  expect(await violations()).toEqual([]);
});
