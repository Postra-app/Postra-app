import { expect, Page, test } from '@playwright/test';
import { createDraft, signedIn, stateFile } from '../helpers';
import { quietSlot, weekOf } from './ui-helpers';

// What a first-time user could not read or could not tell apart: menu text
// that vanished under the pointer, week tiles without their time, a composer
// that did not say what to click, Studio on the light theme.
test.use({ storageState: stateFile('a'), viewport: { width: 1440, height: 900 } });

// Relative luminance of a CSS colour, 0 (black) to 1 (white).
const luminance = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const [r, g, b] = getComputedStyle(el)
      .color.match(/[\d.]+/g)!
      .slice(0, 3)
      .map((n) => {
        const c = Number(n) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }, selector);

test('a menu item under the pointer stays readable on the dark theme', async ({ page }) => {
  await page.goto('/launches');
  const item = page.locator('a[href="/analytics"]').first();
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.hover();
  // The dark navy of the selected item (on its white pill) was reused here,
  // on a dark background. Light text has a luminance well above 0.5.
  await expect.poll(() => luminance(page, 'a[href="/analytics"]')).toBeGreaterThan(0.5);
});

test('a week tile shows the time of its post', async ({ page }) => {
  const api = await signedIn('a');
  const slot = quietSlot(3);
  const content = `Clarity time ${Date.now()}`;
  await createDraft(api, 'a', content, slot);
  await page.goto(weekOf(slot));
  await expect(page.getByText(content).first()).toBeVisible({ timeout: 20_000 });
  const time = `04:${String(slot.getMinutes()).padStart(2, '0')}`;
  await expect(page.getByText(time, { exact: false }).first()).toBeVisible();
});

test('an empty composer says to pick a channel, and stops saying it once one is picked', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).first().click();
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await expect(editor).toBeVisible();
  const hint = editor.getByText('Click a channel to choose where this post goes');
  await expect(hint).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Select a channel first' })).toBeDisabled();
  // The "all channels" tab had a name for screen readers only.
  await expect(editor.getByRole('button', { name: 'Text for all channels' })).toHaveAttribute(
    'data-tooltip-content',
    'Text for all channels'
  );

  await editor.getByRole('img', { name: 'bluesky', exact: true }).first().click();
  await expect(hint).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Add to Calendar' })).toBeVisible();
});

test('Studio on the light theme stands on a dark base of its own', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('body')).toHaveClass(/\blight\b/);
  await page.goto('/studio');
  const root = page.locator('.studio-root').first();
  await expect(root).toBeVisible({ timeout: 20_000 });
  // Its panels are see-through and its text is light: without a base of its
  // own they sat on the light page.
  await expect
    .poll(() => root.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(12, 18, 32)');
});

test('the composer on the light theme has a light editor', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('body')).toHaveClass(/\blight\b/);
  await page.getByRole('button', { name: 'Create Post' }).first().click();
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await expect(editor).toBeVisible();
  // The editor kept a dark background of its own under the theme's dark text.
  const background = await editor
    .getByRole('textbox')
    .first()
    .evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node) {
        const colour = getComputedStyle(node).backgroundColor;
        if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return colour;
        node = node.parentElement;
      }
      return '';
    });
  expect(background).toBe('rgb(255, 255, 255)');
});
