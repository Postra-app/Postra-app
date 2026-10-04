import { expect, Page, test } from '@playwright/test';

// Every form control has a name a screen reader can announce. Settings →
// Global had its selects (language, time format, shortlinks) with an empty
// label and nothing else — read out as "combo box", no more.

const unnamedControls = (page: Page) =>
  page.locator('select, input:not([type=hidden]), textarea').evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => {
        const field = el as HTMLInputElement;
        const byLabel = [...(field.labels || [])].map((l) => l.textContent?.trim()).join('');
        const byAria = field.getAttribute('aria-label')?.trim();
        const byRef = field
          .getAttribute('aria-labelledby')
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim())
          .join('');
        return !byLabel && !byAria && !byRef && !field.title;
      })
      .map((el) => el.outerHTML.slice(0, 120))
  );

test('Settings → Global: every field has an accessible name', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('combobox', { name: 'Interface language' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Time format' })).toBeVisible();
  // Shortlinks appear only with a shortener configured (none in the stack, none
  // in production); when they do, the check below covers them.
  expect(await unnamedControls(page)).toEqual([]);
});

test('Time format: AM:PM shows 12-hour times in the calendar, 24 hours switches back', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.getByRole('combobox', { name: 'Time format' }).selectOption('US');
  await page.goto('/launches?display=day');
  await expect(page.getByText(/^\d{1,2}:\d{2} (AM|PM)$/).first()).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('combobox', { name: 'Time format' }).selectOption('GLOBAL');
  await page.goto('/launches?display=day');
  await expect(page.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible();
  await expect(page.getByText(/^\d{1,2}:\d{2} (AM|PM)$/)).toHaveCount(0);
});
