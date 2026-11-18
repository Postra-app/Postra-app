import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// In the light theme the plain windows (language, sign out, confirmations,
// "Payment required") kept the dark navy panel under near-black text.
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

test('a plain window in the light theme is light and readable', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('body')).toHaveClass(/\blight\b/);
  await page.getByRole('button', { name: 'Change Language' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Language' });
  await expect(dialog).toBeVisible();
  // Wait out the opening animation before measuring colours.
  await page.waitForTimeout(600);

  const background = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = (background.match(/[\d.]+/g) || []).map(Number);
  expect(r + g + b, `panel background ${background}`).toBeGreaterThan(600);

  await page.evaluate(AXE);
  const contrast = await page.evaluate(async () => {
    const result = await (window as any).axe.run('[role="dialog"]', {
      runOnly: { type: 'rule', values: ['color-contrast'] },
    });
    return result.violations.map((v: any) => `${v.id} ×${v.nodes.length}: ${v.nodes[0].target.join(' ')}`);
  });
  expect(contrast).toEqual([]);

  // Back to the dark theme for the specs that share this account's browser.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
});
