import { expect, Page, test } from '@playwright/test';
import sharp from 'sharp';
import { watchForErrors } from './ui-helpers';

// Every Graphics tool in Studio, the way a customer reaches it, under
// production's Content-Security-Policy (the stack proxy serves nginx.conf's).
// One test per tool on a fresh canvas, so one broken tool cannot hide the
// rest. Each fails on a console error, a response of 400 or more, or a
// violation of the enforced policy; violations of the report-only nonce
// policy fail too, because they are what breaks once it is enforced.

test.use({ viewport: { width: 1440, height: 900 } });

const photo = () =>
  sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="640" height="480"><circle cx="320" cy="240" r="140" fill="#f5c542"/></svg>'
        ),
      },
    ])
    .jpeg()
    .toBuffer();

// The inspector's W or H field for the selected object.
const inspectorValue = (page: Page, label: 'W' | 'H') =>
  page.evaluate((label) => {
    const tag = [...document.querySelectorAll('span, label, div')].find(
      (e) => e.childElementCount === 0 && e.textContent?.trim() === label
    );
    const input = tag?.parentElement?.querySelector('input') as HTMLInputElement | null;
    return Number(input?.value ?? 0);
  }, label);

const studio = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__violations.push(`${e.effectiveDirective} ${e.blockedURI}`)
    );
  });
  const problems = watchForErrors(page);
  page.setDefaultTimeout(15_000);
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();

  const tool = (name: string) => page.getByRole('button', { name, exact: true }).first();
  // The rail buttons toggle their drawer: open one only when it is not on.
  const open = async (name: string) => {
    if ((await tool(name).getAttribute('aria-pressed')) !== 'true') await tool(name).click();
  };
  const layers = async () => {
    await open('Layers');
    await expect(
      page.getByText(/Top of the list is the front of the design|No layers\. Add text, shape or image first\./)
    ).toBeVisible();
    await page.waitForTimeout(300);
    return page.getByRole('button', { name: /^(Hide|Show)$/ }).count();
  };
  const clean = async () => {
    const violations: string[] = await page.evaluate(() => (window as any).__violations);
    expect(
      [...problems, ...violations.map((v) => `csp: ${v}`)]
        // The stack's fake stock photos come over http from localhost;
        // production's come over https, which img-src allows.
        .filter((p) => !p.includes('localhost:58080'))
    ).toEqual([]);
  };
  const toasts = async () => (await page.getByRole('status').allInnerTexts()).join(' ');
  const uploadPhoto = async () => {
    await open('Images');
    const uploaded = page.waitForResponse(
      (r) => r.url().includes('/media/upload-simple') && r.request().method() === 'POST'
    );
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'studio-tools.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(),
    });
    expect((await uploaded).status()).toBe(201);
    await page.waitForTimeout(1500);
  };
  return { tool, open, layers, clean, toasts, uploadPhoto };
};

test('Text, Shapes and Icons each add a layer', async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await page.waitForTimeout(800);
  expect(await s.layers()).toBe(1);
  await s.open('Shapes');
  await page.getByRole('button', { name: /Rectangle/i }).first().click();
  expect(await s.layers()).toBe(2);
  await s.open('Icons');
  await page.getByPlaceholder('Search icons…').fill('star');
  await page.waitForTimeout(800);
  await page.getByTitle(/star/i).first().click();
  await page.waitForTimeout(1500);
  expect(await s.layers()).toBe(3);
  await s.clean();
});

test('Images: a photo uploads onto the canvas', async ({ page }) => {
  const s = await studio(page);
  await s.uploadPhoto();
  expect(await s.layers()).toBe(1);
  await s.clean();
});

test('Images: smart crop keeps the format, not the old box', async ({ page }) => {
  const s = await studio(page);
  await s.uploadPhoto();
  await page.getByRole('button', { name: /Smart crop to platform/ }).click();
  await page.waitForTimeout(2500);
  // IG Feed, the default format, is 1080x1350.
  const w = await inspectorValue(page, 'W');
  const h = await inspectorValue(page, 'H');
  expect(w).toBeGreaterThan(0);
  expect(h / w).toBeCloseTo(1350 / 1080, 1);
  expect(await s.toasts()).not.toMatch(/fail/i);
  await s.clean();
});

test('Images: remove background puts a library cut-out on the canvas', async ({ page }) => {
  const s = await studio(page);
  await s.uploadPhoto();
  const done = page.waitForResponse(
    (r) => r.url().includes('/media/remove-background') && r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: /Remove background/ }).click();
  expect((await done).status()).toBe(201);
  await expect(page.getByRole('button', { name: /Removing/ })).toHaveCount(0);
  expect(await s.toasts()).not.toMatch(/fail|unavailable/i);
  expect(await s.layers()).toBe(1);
  await s.clean();
});

test('Stock photos: search shows results', async ({ page }) => {
  const s = await studio(page);
  await s.open('Stock photos');
  await page.getByRole('button', { name: 'Unsplash', exact: true }).click();
  await page.getByPlaceholder('e.g. coffee, office, summer').fill(`studio tools ${Date.now()}`);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Unsplash', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Photo by')).toBeVisible();
  await s.clean();
});

test('Templates: a built-in template fills the canvas', async ({ page }) => {
  const s = await studio(page);
  await s.open('Templates');
  await page.getByText('Modern Promo').first().click();
  await page.waitForTimeout(2500);
  expect(await s.layers()).toBeGreaterThan(2);
  expect(await s.toasts()).not.toMatch(/Failed to apply template/);
  await s.clean();
});

test('Brand Kit opens and loads', async ({ page }) => {
  const s = await studio(page);
  await s.open('Brand Kit');
  await expect(page.getByText('Loading brand kit…')).toHaveCount(0);
  await s.clean();
});

test('Layers: hide and show a layer', async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await page.waitForTimeout(800);
  await s.layers();
  await page.getByRole('button', { name: 'Hide', exact: true }).first().click();
  await page.getByRole('button', { name: 'Show', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Hide', exact: true })).toHaveCount(1);
  await s.clean();
});

test('Carousel: add and duplicate slides', async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await page.getByRole('button', { name: /Carousel mode/ }).click();
  await page.getByRole('button', { name: '+ Slide', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByText(/Slide \d of 3/)).toBeVisible();
  await s.clean();
});

test('Download PNG and Save as template', async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Download PNG/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);

  await page.getByRole('button', { name: 'Export' }).click();
  const saved = page.waitForResponse(
    (r) => r.url().includes('/media/upload-simple') && r.request().method() === 'POST'
  );
  await page.getByRole('menuitem', { name: /Save as template/ }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByText('Your templates', { exact: false })).toBeVisible();
  await s.clean();
});
