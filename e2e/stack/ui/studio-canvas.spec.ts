import { expect, Page, test } from '@playwright/test';
import { design, hex, pixel, prop, studio, types } from './studio-helpers';

// The canvas itself: its background, the order and locking of its layers,
// zoom, redo and the shortcut list. Each checked on what the design or the
// screen really shows.

test.use({ viewport: { width: 1440, height: 900 } });

const background = async (page: Page) => (await design(page))?.canvas.background;

/** A design with one text and nothing selected, so the swatches colour the
 *  canvas (the draft is written only for a canvas with something on it). */
const withNothingSelected = async (page: Page) => {
  const s = await studio(page);
  await s.addText();
  await page.getByTitle('Undo (Ctrl+Z)').focus();
  await page.keyboard.press('Escape');
  await s.open('Shapes');
  await expect(page.getByText('Nothing selected - these colours set the canvas background.', { exact: false })).toBeVisible();
  return s;
};

test.describe('background', () => {
  test('a colour swatch paints the canvas in that colour', async ({ page }) => {
    const s = await withNothingSelected(page);
    await page.getByRole('button', { name: 'Background #e94560', exact: true }).click();
    await expect.poll(() => background(page)).toBe('#e94560');
    expect(hex(await pixel(page, 0.02, 0.02))).toBe('#e94560');
    await s.clean();
  });

  test('Custom color paints the canvas in the colour picked', async ({ page }) => {
    const s = await withNothingSelected(page);
    await page.getByLabel('Custom color', { exact: true }).fill('#123456');
    await expect.poll(() => background(page)).toBe('#123456');
    expect(hex(await pixel(page, 0.98, 0.98))).toBe('#123456');
    await s.clean();
  });

  test('Gradient background fades the chosen colour into a darker one, top to bottom', async ({ page }) => {
    const s = await withNothingSelected(page);
    await page.getByRole('button', { name: 'Background #2a9d8f', exact: true }).click();
    await page.getByRole('button', { name: 'Gradient background' }).click();
    await expect
      .poll(() => background(page))
      .toMatchObject({ type: 'linear', colorStops: [{ offset: 0, color: '#2a9d8f' }, { offset: 1 }] });
    const top = await pixel(page, 0.5, 0.01);
    const bottom = await pixel(page, 0.5, 0.99);
    // The first row of pixels is a hair into the fade already.
    top.slice(0, 3).forEach((v, i) => expect(Math.abs(v - [0x2a, 0x9d, 0x8f][i])).toBeLessThanOrEqual(3));
    // Darker at the bottom, every channel.
    for (let i = 0; i < 3; i += 1) expect(bottom[i]).toBeLessThan(top[i] * 0.6);
    await s.clean();
  });
});

test.describe('layers', () => {
  const rowOf = (page: Page, name: string) => page.locator(`div:has(> button[title="${name}"])`);
  const centre = async (page: Page) => {
    const box = (await page.locator('canvas.upper-canvas').boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const selected = (page: Page) => page.getByText('Selected object', { exact: true });

  test('a locked layer cannot be selected or dragged on the canvas, and Unlock frees it', async ({ page }) => {
    const s = await studio(page);
    await s.addShape(/Rectangle/i, 'rect');
    await s.layers();
    await rowOf(page, 'Rect').getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(rowOf(page, 'Rect').getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
    await expect(selected(page)).toHaveCount(0);
    const before = [await prop(page, 'rect', 'left'), await prop(page, 'rect', 'top')];

    // The rectangle sits in the middle of the canvas.
    const { x, y } = await centre(page);
    await page.mouse.click(x, y);
    await expect(selected(page)).toHaveCount(0);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y + 80, { steps: 8 });
    await page.mouse.up();
    expect([await prop(page, 'rect', 'left'), await prop(page, 'rect', 'top')]).toEqual(before);
    // Nor from the list.
    await page.getByRole('button', { name: 'Rect', exact: true }).click();
    await expect(selected(page)).toHaveCount(0);

    await rowOf(page, 'Rect').getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.mouse.click(x, y);
    await expect(selected(page)).toBeVisible();
    await s.clean();
  });

  // The lock lives on the Fabric object only (selectable/evented), which the
  // design's JSON does not carry: every undo, slide switch or refresh loads
  // the design back from JSON, unlocked.
  // FIXME app bug: layers-panel.tsx sets selectable/evented, which toJSON() drops (lock lost on undo/refresh).
  test.fixme('a locked layer stays locked after undoing a later change and after a refresh', async ({ page }) => {
    const s = await studio(page);
    await s.addShape(/Rectangle/i, 'rect');
    await s.layers();
    await rowOf(page, 'Rect').getByRole('button', { name: 'Lock', exact: true }).click();
    await s.tool('Text').click();
    await expect.poll(() => types(page)).toEqual(['rect', 'textbox']);
    await s.undo();
    await expect.poll(() => types(page)).toEqual(['rect']);
    const { x, y } = await centre(page);
    await page.mouse.click(x, y);
    await expect(selected(page)).toHaveCount(0);
    await s.layers();
    await expect(rowOf(page, 'Rect').getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => s.layers()).toEqual(['Rect']);
    await expect(rowOf(page, 'Rect').getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
    await s.clean();
  });

  // Moving a layer up or down was no undo step: the Ctrl+Z meant for it took
  // the change before it (here the text just added) and left the order as it
  // was.
  // FIXME app bug: layers-panel.tsx reorders without firing object:modified, so no history step is recorded.
  test.fixme('Send backward is one undo step: Ctrl+Z puts the order back and keeps the text', async ({ page }) => {
    const s = await studio(page);
    await s.addShape(/Rectangle/i, 'rect');
    await s.tool('Text').click();
    await expect.poll(() => types(page)).toEqual(['rect', 'textbox']);
    await s.layers();
    await rowOf(page, 'Type your text').getByRole('button', { name: 'Send backward', exact: true }).click();
    await expect.poll(() => types(page)).toEqual(['textbox', 'rect']);
    await s.undo();
    await expect.poll(() => types(page)).toEqual(['rect', 'textbox']);
    await s.clean();
  });

  test('Send backward and Bring forward change which layer is in front', async ({ page }) => {
    const s = await studio(page);
    await s.addShape(/Rectangle/i, 'rect');
    await s.tool('Text').click();
    await expect.poll(() => types(page)).toEqual(['rect', 'textbox']);
    expect(await s.layers()).toEqual(['Type your text', 'Rect']);

    await rowOf(page, 'Type your text').getByRole('button', { name: 'Send backward', exact: true }).click();
    await expect.poll(() => types(page)).toEqual(['textbox', 'rect']);
    expect(await s.layers()).toEqual(['Rect', 'Type your text']);

    await rowOf(page, 'Type your text').getByRole('button', { name: 'Bring forward', exact: true }).click();
    await expect.poll(() => types(page)).toEqual(['rect', 'textbox']);
    expect(await s.layers()).toEqual(['Type your text', 'Rect']);
    await s.clean();
  });
});

test.describe('canvas', () => {
  const zoom = (page: Page) =>
    page
      .getByRole('button', { name: 'Zoom out', exact: true })
      .locator('xpath=following-sibling::span[1]')
      .innerText()
      .then((text) => Number(text.replace('%', '')));
  const shownWidth = (page: Page) =>
    page.locator('canvas.lower-canvas').evaluate((c) => c.getBoundingClientRect().width);

  test('Zoom in, Zoom out, 100% and Fit change the size the design is shown at', async ({ page }) => {
    const s = await studio(page);
    const fit = await zoom(page);
    const fitWidth = await shownWidth(page);
    expect(fit).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect.poll(() => zoom(page)).toBe(Math.round(fit * 1.2));
    expect(await shownWidth(page)).toBeCloseTo(fitWidth * 1.2, -1);

    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect.poll(() => zoom(page)).toBe(Math.round(fit / 1.2));
    expect(await shownWidth(page)).toBeCloseTo(fitWidth / 1.2, -1);

    // The design at its real size: IG Feed is 1080 px wide.
    await page.getByRole('button', { name: '100%', exact: true }).click();
    await expect.poll(() => zoom(page)).toBe(100);
    expect(await shownWidth(page)).toBeCloseTo(1080, 0);

    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect.poll(() => zoom(page)).toBe(fit);
    expect(await shownWidth(page)).toBeCloseTo(fitWidth, 0);
    await s.clean();
  });

  test('Redo puts back what Undo took, from the button and from Ctrl+Shift+Z', async ({ page }) => {
    const s = await studio(page);
    await s.addShape(/Rectangle/i, 'rect');
    const redo = page.getByTitle('Redo (Ctrl+Shift+Z)');
    await expect(redo).toBeDisabled();

    await s.undo();
    await expect.poll(async () => (await design(page))?.canvas.objects.length ?? 0).toBe(0);
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect.poll(() => types(page)).toEqual(['rect']);

    await s.undo();
    await expect.poll(async () => (await design(page))?.canvas.objects.length ?? 0).toBe(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => types(page)).toEqual(['rect']);
    await expect(redo).toBeDisabled();
    await s.clean();
  });

  test('? opens the keyboard shortcuts, Escape and Close shut them', async ({ page }) => {
    const s = await studio(page);
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await page.getByTitle('Undo (Ctrl+Z)').focus();
    await page.keyboard.press('?');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Press ? at any time to open this list.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    await page.getByRole('button', { name: 'Keyboard shortcuts (?)' }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await s.clean();
  });
});
