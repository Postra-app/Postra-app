import { Download, expect, Page, test } from '@playwright/test';
import JSZip from 'jszip';
import { studio } from './studio-helpers';

// Export → All formats: the files that leave Studio, read back here. Each
// format has to come out at its own size, one by one and in the ZIP.

test.use({ viewport: { width: 1440, height: 900 } });

const FORMATS: Record<string, [number, number]> = {
  'instagram-feed': [1080, 1350],
  'instagram-square': [1080, 1080],
  'instagram-story': [1080, 1920],
  'facebook-feed': [1080, 1080],
  'linkedin-feed': [1200, 1200],
  'tiktok-cover': [1080, 1920],
  'x-post': [1600, 900],
  'pinterest-pin': [1000, 1500],
};

const bytes = async (download: Download) => {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};
// A PNG says its size in the IHDR chunk, bytes 16-23.
const pngSize = (png: Buffer) => {
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

const allFormats = async (page: Page) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /All formats/ }).click();
  const modal = page.getByRole('dialog', { name: 'Export to all platforms' });
  await expect(modal.getByRole('button', { name: 'Download', exact: true })).toHaveCount(8, { timeout: 45_000 });
  return { s, modal };
};

test('All formats → Download saves that one format as a PNG of its size', async ({ page }) => {
  test.setTimeout(90_000);
  const { s, modal } = await allFormats(page);
  for (const [label, key] of [
    ['X Post (16:9)', 'x-post'],
    ['IG Story (9:16)', 'instagram-story'],
  ] as const) {
    const download = page.waitForEvent('download');
    await modal
      .getByText(label, { exact: true })
      .locator('xpath=following-sibling::button')
      .click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`^postra-${key}-\\d+\\.png$`));
    expect(pngSize(await bytes(file))).toEqual(FORMATS[key]);
  }
  await s.clean();
});

test('All formats → Download all (ZIP) holds one PNG per format, each at its size', async ({ page }) => {
  test.setTimeout(90_000);
  const { s, modal } = await allFormats(page);
  const download = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Download all (ZIP)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^postra-multiformat-\d+\.zip$/);
  const zip = await JSZip.loadAsync(await bytes(file));
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(Object.keys(FORMATS).map((k) => `${k}.png`).sort());
  for (const name of names) {
    const png = await zip.file(name)!.async('nodebuffer');
    expect(pngSize(png), name).toEqual(FORMATS[name.replace('.png', '')]);
  }
  await s.clean();
});
