import { expect, test } from '@playwright/test';
import { prop, studio } from './studio-helpers';

// The inspector of the selected object, checked on the object itself: each
// control changes the Fabric object the design is saved from, and one Ctrl+Z
// puts back exactly the value it had before.

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('text', () => {
  for (const [name, key, on] of [
    ['Bold', 'fontWeight', 'bold'],
    ['Italic', 'fontStyle', 'italic'],
  ] as const) {
    test(`${name} sets the text's ${key}, one Ctrl+Z takes it off`, async ({ page }) => {
      const s = await studio(page);
      await s.addText();
      const before = await prop(page, 'textbox', key);
      expect(before).not.toBe(on);
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => prop(page, 'textbox', key)).toBe(on);
      await s.undo();
      await expect.poll(() => prop(page, 'textbox', key)).toBe(before);
      await s.clean();
    });
  }

  test('Font size typed into its field is the size of the text, one Ctrl+Z restores it', async ({ page }) => {
    const s = await studio(page);
    await s.addText();
    const before = await prop(page, 'textbox', 'fontSize');
    const field = page.getByRole('spinbutton', { name: 'Font size', exact: true });
    await field.click();
    await field.press('ControlOrMeta+a');
    await page.keyboard.type('96');
    await page.keyboard.press('Enter');
    await expect.poll(() => prop(page, 'textbox', 'fontSize')).toBe(96);
    await expect(page.getByRole('slider', { name: 'Font size', exact: true })).toHaveValue('96');
    await s.undo();
    await expect.poll(() => prop(page, 'textbox', 'fontSize')).toBe(before);
    await s.clean();
  });

  test('Shadow puts a shadow under the text, one Ctrl+Z takes it off', async ({ page }) => {
    const s = await studio(page);
    await s.addText();
    expect(await prop(page, 'textbox', 'shadow')).toBeFalsy();
    await page.getByRole('button', { name: 'Shadow', exact: true }).click();
    await expect
      .poll(() => prop(page, 'textbox', 'shadow'))
      .toMatchObject({ color: 'rgba(0,0,0,0.45)', blur: 12, offsetY: 4 });
    await s.undo();
    await expect.poll(() => prop(page, 'textbox', 'shadow')).toBeFalsy();
    await s.clean();
  });

  test('Text outline draws a black outline under the letters, one Ctrl+Z restores the width', async ({ page }) => {
    const s = await studio(page);
    await s.addText();
    const before = await prop(page, 'textbox', 'strokeWidth');
    const outline = page.getByRole('slider', { name: 'Text outline', exact: true });
    await outline.focus();
    // One key, one undo step: every press of a slider is its own change.
    await page.keyboard.press('End');
    await expect.poll(() => prop(page, 'textbox', 'strokeWidth')).toBe(20);
    expect(before).not.toBe(20);
    expect(await prop(page, 'textbox', 'stroke')).toBe('#000000');
    // Under the fill, so a thick outline does not eat into the letters.
    expect(await prop(page, 'textbox', 'paintFirst')).toBe('stroke');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => prop(page, 'textbox', 'strokeWidth')).toBe(before);
    await s.clean();
  });

  test('Outline colour recolours the text outline, one Ctrl+Z brings the old colour back', async ({ page }) => {
    const s = await studio(page);
    await s.addText();
    await page.getByRole('slider', { name: 'Text outline', exact: true }).focus();
    await page.keyboard.press('End');
    await expect.poll(() => prop(page, 'textbox', 'stroke')).toBe('#000000');
    const width = await prop(page, 'textbox', 'strokeWidth');
    await page.getByLabel('Outline colour', { exact: true }).fill('#ff3366');
    // The colour commits when its well is left.
    await page.getByTitle('Undo (Ctrl+Z)').focus();
    await expect.poll(() => prop(page, 'textbox', 'stroke')).toBe('#ff3366');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => prop(page, 'textbox', 'stroke')).toBe('#000000');
    expect(await prop(page, 'textbox', 'strokeWidth')).toBe(width);
    await s.clean();
  });

  test('Highlight puts a colour behind the text and its colour well changes it, one Ctrl+Z each', async ({
    page,
  }) => {
    const s = await studio(page);
    await s.addText();
    expect(await prop(page, 'textbox', 'textBackgroundColor')).toBeFalsy();
    await page.getByRole('button', { name: 'Highlight', exact: true }).click();
    await expect.poll(() => prop(page, 'textbox', 'textBackgroundColor')).toBe('#0a0e1a');
    await page.getByLabel('Highlight colour', { exact: true }).fill('#fbbf24');
    await page.getByTitle('Undo (Ctrl+Z)').focus();
    await expect.poll(() => prop(page, 'textbox', 'textBackgroundColor')).toBe('#fbbf24');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => prop(page, 'textbox', 'textBackgroundColor')).toBe('#0a0e1a');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => prop(page, 'textbox', 'textBackgroundColor')).toBeFalsy();
    await s.clean();
  });

  for (const [name, key] of [
    ['Letter spacing', 'charSpacing'],
    ['Line spacing', 'lineHeight'],
  ] as const) {
    test(`${name} changes the text's ${key}, one Ctrl+Z restores it`, async ({ page }) => {
      const s = await studio(page);
      await s.addText();
      const before = Number(await prop(page, 'textbox', key));
      const slider = page.getByRole('slider', { name, exact: true });
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => Number(await prop(page, 'textbox', key))).toBeGreaterThan(before);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => Number(await prop(page, 'textbox', key))).toBe(before);
      await s.clean();
    });
  }
});

test.describe('shape', () => {
  const rectangle = async (page: import('@playwright/test').Page) => {
    const s = await studio(page);
    await s.addShape(/Rectangle/i, 'rect');
    await s.select('Rect');
    return s;
  };

  for (const [label, name, key] of [
    ['Flip H', 'Flip horizontally', 'flipX'],
    ['Flip V', 'Flip vertically', 'flipY'],
  ] as const) {
    test(`${label} mirrors the object (${key}), one Ctrl+Z puts it back`, async ({ page }) => {
      const s = await rectangle(page);
      expect(await prop(page, 'rect', key)).toBe(false);
      await page.getByRole('button', { name, exact: true }).click();
      await expect.poll(() => prop(page, 'rect', key)).toBe(true);
      await s.undo();
      await expect.poll(() => prop(page, 'rect', key)).toBe(false);
      await s.clean();
    });
  }

  test('Rotation typed into its field turns the object, one Ctrl+Z turns it back', async ({ page }) => {
    const s = await rectangle(page);
    const field = page.getByRole('spinbutton', { name: 'Rotation', exact: true });
    await field.click();
    await field.press('ControlOrMeta+a');
    await page.keyboard.type('45');
    await page.keyboard.press('Enter');
    await expect.poll(() => prop(page, 'rect', 'angle')).toBe(45);
    await s.undo();
    await expect.poll(() => prop(page, 'rect', 'angle')).toBe(0);
    await s.clean();
  });

  test('Opacity fades the object on the canvas, one Ctrl+Z makes it solid again', async ({ page }) => {
    const s = await rectangle(page);
    const slider = page.getByRole('slider', { name: 'Opacity', exact: true });
    await slider.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => prop(page, 'rect', 'opacity')).toBe(0.05);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => prop(page, 'rect', 'opacity')).toBe(1);
    await s.clean();
  });

  test('Corner radius rounds the rectangle, one Ctrl+Z restores the corners', async ({ page }) => {
    const s = await rectangle(page);
    const before = await prop(page, 'rect', 'rx');
    const slider = page.getByRole('slider', { name: 'Corner radius', exact: true });
    await slider.focus();
    await page.keyboard.press('End');
    // The most a 150 px square takes: half its side.
    await expect.poll(() => prop(page, 'rect', 'rx')).toBe(75);
    expect(await prop(page, 'rect', 'ry')).toBe(75);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => prop(page, 'rect', 'rx')).toBe(before);
    await s.clean();
  });

  test('Outline width draws an outline, one Ctrl+Z takes it off', async ({ page }) => {
    const s = await rectangle(page);
    const before = await prop(page, 'rect', 'strokeWidth');
    const slider = page.getByRole('slider', { name: 'Outline width', exact: true });
    await slider.focus();
    await page.keyboard.press('End');
    await expect.poll(() => prop(page, 'rect', 'strokeWidth')).toBe(40);
    expect(before).not.toBe(40);
    // A width without a colour would draw nothing.
    expect(await prop(page, 'rect', 'stroke')).toBe('#ffffff');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => prop(page, 'rect', 'strokeWidth')).toBe(before);
    await s.clean();
  });

  test('Outline colour of a shape recolours its outline, one Ctrl+Z brings the old colour back', async ({
    page,
  }) => {
    const s = await rectangle(page);
    await page.getByRole('slider', { name: 'Outline width', exact: true }).focus();
    await page.keyboard.press('End');
    await expect.poll(() => prop(page, 'rect', 'stroke')).toBe('#ffffff');
    await page.getByLabel('Outline colour', { exact: true }).fill('#10b981');
    await page.getByTitle('Undo (Ctrl+Z)').focus();
    await expect.poll(() => prop(page, 'rect', 'stroke')).toBe('#10b981');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => prop(page, 'rect', 'stroke')).toBe('#ffffff');
    expect(await prop(page, 'rect', 'strokeWidth')).toBe(40);
    await s.clean();
  });
});
