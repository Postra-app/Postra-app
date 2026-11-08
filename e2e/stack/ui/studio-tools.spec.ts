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

// Pinterest's recommended pin is 2:3; the PNG has to come out at that size.
test('Pinterest Pin (2:3) downloads as a 1000x1500 PNG', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await page.getByRole('button', { name: 'Pinterest Pin (2:3)', exact: true }).click();
  await expect(page.getByText('1000×1500px')).toBeVisible();
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Download PNG/ }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const png = Buffer.concat(chunks);
  // A PNG says its size in the IHDR chunk, bytes 16-23.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1000, 1500]);
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

// Undo is one step per action, from wherever the action was made.
const addText = async (page: Page, s: Awaited<ReturnType<typeof studio>>) => {
  await s.tool('Text').click();
  await page.waitForTimeout(800);
  expect(await s.layers()).toBe(1);
  await selectFirstLayer(page);
};
const selectFirstLayer = async (page: Page) => {
  await page.locator('div:has(> button[aria-label="Bring forward"]) > button:first-child').first().click();
  await expect(page.getByRole('slider', { name: 'Letter spacing' })).toBeVisible();
};
const undoKey = (page: Page) => page.keyboard.press('ControlOrMeta+z');

// Clicking a slider leaves the focus on it, and Ctrl+Z was ignored while any
// <input> had the focus: the change could only be undone after clicking away.
test('Undo: Ctrl+Z straight after a slider undoes the slider', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await addText(page, s);
  const spacing = page.getByRole('slider', { name: 'Letter spacing' });
  const before = await spacing.inputValue();
  await spacing.focus();
  await page.keyboard.press('ArrowRight');
  await expect(spacing).not.toHaveValue(before);
  await undoKey(page);
  await selectFirstLayer(page);
  await expect(spacing).toHaveValue(before);
  await s.clean();
});

// A field the user only passed through committed the unchanged design, and
// each of those empty entries took one Ctrl+Z that visibly did nothing.
test('Undo: passing through the inspector adds no undo step', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await addText(page, s);
  for (const name of ['Letter spacing', 'Line spacing', 'Opacity', 'Rotation']) {
    await page.getByRole('slider', { name }).first().focus();
    await page.keyboard.press('Tab');
  }
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect.poll(() => s.layers()).toBe(0);
  await s.clean();
});

// Holding an arrow key repeats it many times a second; every repeat was its
// own undo step, which pushed the earlier work out of the 30-step history.
test('Undo: holding an arrow key moves the object as one step', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await addText(page, s);
  const x = await inspectorValue(page, 'X' as 'W');
  await page.getByTitle('Undo (Ctrl+Z)').focus();
  for (let i = 0; i < 12; i += 1) await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  await expect.poll(() => inspectorValue(page, 'X' as 'W')).toBeGreaterThan(x);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect.poll(() => s.layers()).toBe(1);
  await selectFirstLayer(page);
  await expect.poll(() => inspectorValue(page, 'X' as 'W')).toBe(x);
  await s.clean();
});

// Copying a multiple selection copied the selection box itself: the paste
// arrived as one object that could not be taken apart.
test('Select: copy and paste, and duplicate, of several objects give each its own layer', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await s.open('Shapes');
  await page.getByRole('button', { name: /Rectangle/i }).first().click();
  expect(await s.layers()).toBe(2);
  await page.getByTitle('Undo (Ctrl+Z)').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => s.layers()).toBe(4);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+d');
  await expect.poll(() => s.layers()).toBe(8);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect.poll(() => s.layers()).toBe(4);

  // Deleting several objects was one undo step per object.
  await page.getByTitle('Undo (Ctrl+Z)').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await expect.poll(() => s.layers()).toBe(0);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect.poll(() => s.layers()).toBe(4);
  await s.clean();
});

// The font of a selected text could only be changed from the Text tool, whose
// rail button adds a new text, and the change was no undo step: the Ctrl+Z
// meant for the font undid the step before it as well.
test('Font of the selected text: changed from the inspector, one Ctrl+Z brings it back', { tag: '@safari' }, async ({
  page,
}) => {
  const s = await studio(page);
  await addText(page, s);
  const font = page.getByRole('combobox', { name: 'Font', exact: true });
  await expect(font).toHaveValue(/Geist/);
  await font.selectOption({ label: 'Montserrat' });
  await expect(font).toHaveValue(/Montserrat/);
  expect(await s.layers()).toBe(1);
  await undoKey(page);
  await expect.poll(() => s.layers()).toBe(1);
  await selectFirstLayer(page);
  await expect(font).toHaveValue(/Geist/);
  await s.clean();
});

// The credit is spent on the server whatever the browser does. Opening
// another panel while the design was being made aborted the request and the
// paid-for design never reached the canvas.
test('AI Generate: the design lands on the canvas after a switch to another panel', { tag: '@safari' }, async ({
  page,
}) => {
  test.setTimeout(90_000);
  const s = await studio(page);
  await page.route('**/api/media/generate-post-design', async (route) => {
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 2_500));
    await route.fulfill({ response });
  });
  await s.open('AI Generate');
  await page.getByPlaceholder('e.g. Summer sale -50% at a clothing store').fill('Autumn coffee offer at a small cafe');
  const done = page.waitForResponse((r) => r.url().includes('/media/generate-post-design'));
  await page.getByRole('button', { name: 'Generate Design', exact: true }).click();
  await s.open('Layers');
  expect((await done).status()).toBe(201);
  await expect.poll(() => s.layers(), { timeout: 20_000 }).toBeGreaterThan(1);
  await s.clean();
});

test('AI Generate: a carousel of three makes three slides', { tag: '@safari' }, async ({ page }) => {
  test.setTimeout(90_000);
  const s = await studio(page);
  await s.open('AI Generate');
  await page.getByPlaceholder('e.g. Summer sale -50% at a clothing store').fill('Three tips for a calmer morning');
  await page.locator('select:has(option[value="5"])').selectOption('3');
  const done = page.waitForResponse((r) => r.url().includes('/media/generate-carousel-design'));
  await page.getByRole('button', { name: 'Generate carousel (3)', exact: true }).click();
  expect((await done).status()).toBe(201);
  await expect(page.getByRole('button', { name: /^Go to Slide \d+$/ })).toHaveCount(3, { timeout: 20_000 });
  await s.clean();
});

// Out of credits: say so once, with the way to more, and leave the button
// usable.
test('AI Generate: out of credits is said once, with the way to Billing', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await page.route('**/api/media/generate-post-design', (route) =>
    route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 402,
        message: 'No image generation credits remaining for this billing cycle',
      }),
    })
  );
  await s.open('AI Generate');
  await page.getByPlaceholder('e.g. Summer sale -50% at a clothing store').fill('Spring sale');
  await page.getByRole('button', { name: 'Generate Design', exact: true }).click();
  await expect(page.getByText('No image generation credits remaining for this billing cycle')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Go to billing' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Generate Design', exact: true })).toBeEnabled();
});

// A Refine that added or removed layers recorded each of them, plus an
// unstamped copy of the result: the first Ctrl+Z after it visibly did nothing.
test('AI Refine: one Ctrl+Z undoes the whole refinement', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await s.tool('Text').click();
  await s.open('Shapes');
  await page.getByRole('button', { name: /Rectangle/i }).first().click();
  expect(await s.layers()).toBe(2);
  await page.route('**/api/media/refine-design', async (route) => {
    const { spec } = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        patch: { ops: spec.layers.map((l: { id: string }) => ({ op: 'delete', id: l.id })) },
        explanation: 'Cleared the design.',
      }),
    });
  });
  await s.open('AI Refine');
  await page.getByPlaceholder(/shorten the headline/).fill('Remove everything');
  await page.getByRole('button', { name: 'Refine design', exact: true }).click();
  await expect(page.getByText('Cleared the design.')).toBeVisible();
  expect(await s.layers()).toBe(0);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect.poll(() => s.layers()).toBe(2);
  await s.clean();
});

// A camera photo (tens of MB) was uploaded as it was and refused by the
// upload limit; the image was then pointed at "undefined". Studio brings it
// down to 2048 px first, like the composer does.
test('Images: a 20+ MB camera photo goes onto the canvas at 2048 px', { tag: '@safari' }, async ({ page }) => {
  test.setTimeout(120_000);
  const s = await studio(page);
  const w = 6000;
  const h = 4000;
  const noise = Buffer.alloc(w * h * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
  const big = await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  expect(big.length).toBeGreaterThan(10 * 1024 * 1024);
  await s.open('Images');
  const uploaded = page.waitForResponse(
    (r) => r.url().includes('/media/upload-simple') && r.request().method() === 'POST'
  );
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'DSC_0001.JPG', mimeType: 'image/jpeg', buffer: big });
  const res = await uploaded;
  expect(res.status()).toBe(201);
  const stored = await sharp(await (await page.request.get((await res.json()).path)).body()).metadata();
  expect([stored.width, stored.height]).toEqual([2048, 1365]);
  await expect.poll(() => s.layers(), { timeout: 15_000 }).toBe(1);
  await s.clean();
});

// A large WebP logo with transparency came out as JPEG, on a black square.
test('Images: a large transparent WebP keeps its transparency', { tag: '@safari' }, async ({ page }) => {
  test.setTimeout(90_000);
  const s = await studio(page);
  const logo = await sharp({
    create: { width: 3000, height: 3000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: Buffer.from('<svg width="3000" height="3000"><circle cx="1500" cy="1500" r="900" fill="#e11d48"/></svg>') }])
    .webp()
    .toBuffer();
  await s.open('Images');
  const uploaded = page.waitForResponse(
    (r) => r.url().includes('/media/upload-simple') && r.request().method() === 'POST'
  );
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'logo.webp', mimeType: 'image/webp', buffer: logo });
  const res = await uploaded;
  expect(res.status()).toBe(201);
  const stored = await sharp(await (await page.request.get((await res.json()).path)).body()).metadata();
  expect(stored.hasAlpha).toBe(true);
  expect(stored.width).toBe(2048);
  await s.clean();
});

// Held arrow, then the window loses focus: the key comes up elsewhere and no
// keyup arrives. The move was never recorded, and the next Ctrl+Z took the
// step before it.
test('Undo: a nudge is recorded when the window loses focus mid-press', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await addText(page, s);
  const x = await inspectorValue(page, 'X' as 'W');
  await page.getByTitle('Undo (Ctrl+Z)').focus();
  for (let i = 0; i < 5; i += 1) await page.keyboard.down('ArrowRight');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect.poll(() => s.layers()).toBe(1);
  await selectFirstLayer(page);
  await expect.poll(() => inspectorValue(page, 'X' as 'W')).toBe(x);
  await page.keyboard.up('ArrowRight');
  await s.clean();
});

// Copy finishes asynchronously (an image is cloned by loading it again), and
// a paste straight after the copy found the clipboard still empty or holding
// the previous copy.
test('Select: a paste straight after the copy pastes what was just copied', { tag: '@safari' }, async ({ page }) => {
  const s = await studio(page);
  await s.uploadPhoto();
  await s.tool('Text').click();
  expect(await s.layers()).toBe(2);
  await page.getByTitle('Undo (Ctrl+Z)').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => s.layers()).toBe(4);
  await s.clean();
});
