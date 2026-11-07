import { expect, Page, test } from '@playwright/test';
import sharp from 'sharp';
import { watchForErrors } from './ui-helpers';

// Every Graphics tool in Studio, the way a customer reaches it, under
// the enforced Content-Security-Policy (the stack proxy serves nginx.conf's).
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
        // real ones come over https, which img-src allows.
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

// A template's photo sits behind its text. The cut-out (and a smart crop or a
// replaced image) used to land on top of every layer, covering the headline,
// and undo took two steps, the first leaving no photo at all.
test('Images: remove background keeps the photo behind the text, one undo brings it back', async ({
  page,
}) => {
  const s = await studio(page);
  await s.uploadPhoto();
  await s.tool('Text').click();
  await page.waitForTimeout(800);
  const order = async () => {
    await s.layers();
    return page
      .locator('div:has(> button[aria-label="Bring forward"]) > button:first-child')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('title')));
  };
  const before = await order();
  expect(before).toHaveLength(2);
  expect(before[1]).toBe('Image');

  await page.locator('button[title="Image"]').click();
  await s.open('Images');
  const done = page.waitForResponse(
    (r) => r.url().includes('/media/remove-background') && r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: /Remove background/ }).click();
  expect((await done).status()).toBe(201);
  await expect(page.getByRole('button', { name: /Removing/ })).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await order()).toEqual(before);

  await page.getByTitle('Undo (Ctrl+Z)').click();
  await page.waitForTimeout(800);
  expect(await order()).toEqual(before);
  await s.clean();
});

test('Stock photos: search shows results', async ({ page }) => {
  const s = await studio(page);
  await s.open('Stock photos');
  await page.getByRole('button', { name: 'Unsplash', exact: true }).click();
  // The panel opens on a starter search; a click and typing replace it.
  const box = page.getByPlaceholder('e.g. coffee, office, summer');
  await expect(box).toHaveValue('business');
  await box.click();
  const query = `studio tools ${Date.now()}`;
  await page.keyboard.type(query);
  await expect(box).toHaveValue(query);
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

// Saved while the Templates panel was already open, the new template did not
// show under "Your templates" until the panel was closed and opened again.
test('Save as template with the Templates panel open lists it at once', async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  const listed = () =>
    page.waitForResponse((r) => r.url().includes('/media/my-templates') && r.status() === 200);
  const first = listed();
  await s.open('Templates');
  await first;
  // Other tests save templates too: compare with what the server says, not
  // with a count taken before.
  const again = listed();
  const marked = page.waitForResponse(
    (r) => /\/media\/[^/]+\/template$/.test(r.url()) && r.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Save as template/ }).click();
  const put = await marked;
  expect(put.status()).toBe(200);
  const id = put.url().split('/').at(-2);
  const list: { id: string }[] = await (await again).json();
  expect(list.map((m) => m.id)).toContain(id);
  await expect(page.locator('button[title^="Apply this template"]')).toHaveCount(list.length);
  await s.clean();
});

// Replace image recorded the swap twice: the first Ctrl+Z changed nothing and
// the old photo came back only on the second.
test('Images: one undo brings back the photo a Replace swapped out', async ({ page }) => {
  const s = await studio(page);
  await s.uploadPhoto();
  // The canvas's average red channel: the photo is blue and yellow, the
  // replacement red.
  const red = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas.lower-canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i];
      return sum / (d.length / 4);
    });
  const before = await red();
  const replaced = page.waitForResponse(
    (r) => r.url().includes('/media/upload-simple') && r.request().method() === 'POST'
  );
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles({
      name: 'replacement.png',
      mimeType: 'image/png',
      buffer: await sharp({
        create: { width: 400, height: 600, channels: 3, background: { r: 230, g: 20, b: 20 } },
      })
        .png()
        .toBuffer(),
    });
  expect((await replaced).status()).toBe(201);
  await expect.poll(red, { timeout: 10_000 }).toBeGreaterThan(before + 20);
  const replacedRed = await red();
  await page.getByTitle('Undo (Ctrl+Z)').click();
  // The photo comes back (re-rendered from history, so within a shade).
  await expect.poll(red, { timeout: 5_000 }).toBeLessThan(before + 3);
  expect(replacedRed).toBeGreaterThan(before + 20);
  await s.clean();
});

// Slide thumbnails were clickable divs: the keyboard could not reach them.
test('Carousel: a slide thumbnail is a button the keyboard reaches', async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await page.getByRole('button', { name: /Carousel mode/ }).click();
  await page.getByRole('button', { name: '+ Slide', exact: true }).click();
  await expect(page.getByText(/Slide 2 of 2/)).toBeVisible();
  const first = page.getByRole('button', { name: 'Go to Slide 1', exact: true });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Slide 1 of 2/)).toBeVisible();
  await expect(first).toHaveAttribute('aria-current', 'true');
  await s.clean();
});
