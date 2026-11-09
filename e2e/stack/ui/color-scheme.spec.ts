import { expect, test } from '@playwright/test';

// The theme switched only Postra's own colours: the page kept the browser's
// light color-scheme, so Safari drew its native parts light on the dark
// theme (white scrollbar tracks beside the composer, light date pickers).
// The scheme now follows the theme.
const scheme = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    root: getComputedStyle(document.documentElement).colorScheme,
    body: getComputedStyle(document.body).colorScheme,
  }));

test('the dark theme gives the page a dark color-scheme @safari', async ({ page }) => {
  await page.goto('/launches');
  await expect(page.getByRole('button', { name: /Create Post/i }).first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => scheme(page)).toEqual({ root: 'dark', body: 'dark' });
});

test('the light theme gives the page a light color-scheme @safari', async ({ page, context }) => {
  await context.addCookies([{ name: 'mode', value: 'light', url: 'http://localhost:54000' }]);
  await page.goto('/launches');
  await expect(page.getByRole('button', { name: /Create Post/i }).first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => scheme(page)).toEqual({ root: 'light', body: 'light' });
});
