import { expect, test } from '@playwright/test';

// App-wide pieces outside any one screen (e2e/08-settings-team-api.md §8.9).

test('a dropped connection is announced, and so is its return', async ({ page, context }) => {
  await page.goto('/launches');
  await expect(page.getByRole('button', { name: 'Create Post' })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole('status')).toContainText("You're offline");
  await context.setOffline(false);
  await expect(page.getByRole('status')).toContainText('Back online.');
});

// Logging out on the web clears this browser's cookie only (other sessions of
// org A's user, in parallel tests, are untouched). Done from the keyboard:
// it was a clickable div that Tab never reached.
test('logging out from Settings works from the keyboard', async ({ page }) => {
  await page.goto('/settings');
  const logout = page.getByRole('button', { name: 'Logout from Postra' });
  await logout.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Yes logout' }).click();
  await page.waitForURL(/\/auth/);
  await page.goto('/launches');
  await expect(page).toHaveURL(/\/auth/);
});
