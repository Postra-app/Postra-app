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

// The topbar's theme, language, notifications and announcement controls were
// divs with click handlers: Tab never reached them and a screen reader read
// nothing. Each is used here from the keyboard only.
test('the theme switches from the keyboard and stays switched', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Switch to light mode' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveClass(/\blight\b/);
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/\blight\b/);
  await page.getByRole('button', { name: 'Switch to dark mode' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveClass(/\bdark\b/);
});

test('the language dialog opens and a language is picked from the keyboard', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Change Language' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Change Language' });
  await expect(dialog.getByRole('button', { name: 'English', pressed: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'polski' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === 'i18next')?.value).toBe('pl');
  // Back to English for the rest of this browser context.
  await page.getByRole('button', { name: /Change Language|Zmień język/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'English' }).click();
});

test('the notifications open from the keyboard', async ({ page }) => {
  await page.goto('/launches');
  const bell = page.getByRole('button', { name: 'Notifications' });
  await bell.focus();
  await page.keyboard.press('Enter');
  await expect(bell).toHaveAttribute('aria-expanded', 'true');
});

test('an announcement opens from the keyboard', async ({ page }) => {
  // Answered in this browser only: a real announcement would show in every
  // parallel test.
  await page.route('**/api/announcements', (route) =>
    route.fulfill({
      json: [
        {
          id: 'stack-announcement',
          title: 'Planned maintenance tonight',
          description: 'Publishing pauses for ten minutes at 23:00 UK time.',
          color: 'INFO',
          createdAt: new Date().toISOString(),
        },
      ],
    })
  );
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Planned maintenance tonight' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Publishing pauses for ten minutes at 23:00 UK time.')).toBeVisible();
});
