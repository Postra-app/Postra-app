import { expect, Page, Request, test } from '@playwright/test';
import sharp from 'sharp';
import { inOwnOrganisation, studio, types } from './studio-helpers';

// The organisation's own Studio material: its brand kit and its saved
// templates, each checked on what the server keeps. In a throwaway
// organisation, so the shared one's kit and templates stay as other specs
// expect them.

test.use({ viewport: { width: 1440, height: 900 } });

const putOf = (page: Page, path: RegExp) =>
  page.waitForRequest((r: Request) => r.method() === 'PUT' && path.test(new URL(r.url()).pathname));

test.describe('in its own organisation', () => {
  inOwnOrganisation();

  test('Brand Kit: the colours of an uploaded logo become the kit, Remove takes the logo off', async ({ page }) => {
    const s = await studio(page);
    // Navy on the left, orange on the right, 64 px square: the panel samples
    // the logo at 64x64, so every pixel is read as it is.
    const logo = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0x10, g: 0x18, b: 0x28, alpha: 1 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 32, height: 64, channels: 4, background: { r: 0xf9, g: 0x73, b: 0x16, alpha: 1 } },
          })
            .png()
            .toBuffer(),
          left: 32,
          top: 0,
        },
      ])
      .png()
      .toBuffer();

    await s.open('Brand Kit');
    await expect(page.getByText('Loading brand kit…')).toHaveCount(0);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload logo' }).click();
    const logoSaved = putOf(page, /\/brand-kit$/);
    await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
    const logoPath = (await logoSaved).postDataJSON().logoPath;
    expect(logoPath).toMatch(/\.png$/);
    await expect(page.getByRole('img', { name: 'Brand logo' })).toBeVisible();

    const coloursSaved = putOf(page, /\/brand-kit$/);
    await page.getByRole('button', { name: 'Use the colours from my logo' }).click();
    expect((await coloursSaved).postDataJSON()).toMatchObject({
      primaryColor: '#f97316',
      secondaryColor: '#101828',
      textColor: '#ffffff',
      logoPath,
    });
    await expect(page.getByLabel('Primary', { exact: true })).toHaveValue('#f97316');
    await expect(page.getByLabel('Background', { exact: true })).toHaveValue('#101828');
    await expect
      .poll(async () => (await page.request.get('/api/brand-kit')).json())
      .toMatchObject({ primaryColor: '#f97316', secondaryColor: '#101828', logoPath });

    const removed = putOf(page, /\/brand-kit$/);
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    expect((await removed).postDataJSON().logoPath).toBeNull();
    await expect(page.getByRole('button', { name: 'Upload logo' })).toBeVisible();
    await expect
      .poll(async () => (await (await page.request.get('/api/brand-kit')).json()).logoPath)
      .toBeNull();
    // The colours stay.
    expect((await (await page.request.get('/api/brand-kit')).json()).primaryColor).toBe('#f97316');
    await s.clean();
  });

  test('Templates: one of Your templates replaces the canvas, and Remove from templates drops it from the list only', async ({
    page,
  }) => {
    const s = await studio(page);
    await s.addShape(/Rectangle/i, 'rect');
    const marked = page.waitForResponse(
      (r) => /\/media\/[^/]+\/template$/.test(r.url()) && r.request().method() === 'PUT'
    );
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: /Save as template/ }).click();
    const put = await marked;
    expect(put.status()).toBe(200);
    const id = put.url().split('/').at(-2);

    // Something else on the canvas.
    await s.undo();
    await expect.poll(() => types(page)).toEqual([]);
    await s.tool('Text').click();
    await expect.poll(() => types(page)).toEqual(['textbox']);

    await s.open('Templates');
    await expect(page.getByText('Your templates')).toBeVisible();
    const apply = page.locator('button[title^="Apply this template"]');
    await expect(apply).toHaveCount(1);
    const loaded = page.waitForResponse((r) => r.url().endsWith(`/media/${id}`) && r.request().method() === 'GET');
    await apply.click();
    expect((await loaded).status()).toBe(200);
    await expect.poll(() => types(page)).toEqual(['rect']);
    // One Ctrl+Z gives the canvas it replaced back.
    await s.undo();
    await expect.poll(() => types(page)).toEqual(['textbox']);

    const removed = page.waitForResponse(
      (r) => r.url().endsWith(`/media/${id}/template`) && r.request().method() === 'PUT'
    );
    await page.getByRole('button', { name: 'Remove from templates (the image stays in your library)' }).click();
    const res = await removed;
    expect(res.status()).toBe(200);
    expect(res.request().postDataJSON()).toEqual({ isTemplate: false });
    await expect(apply).toHaveCount(0);
    await expect(page.getByText('Your templates')).toHaveCount(0);
    expect(await (await page.request.get('/api/media/my-templates')).json()).toEqual([]);
    // The picture is still in the library.
    const library = (await (await page.request.get('/api/media?page=1')).json()).results as { id: string }[];
    expect(library.map((m) => m.id)).toContain(id);
    await s.clean();
  });
});
