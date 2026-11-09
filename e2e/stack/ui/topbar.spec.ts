import { expect, test } from '@playwright/test';

// App-wide pieces outside any one screen.

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
  // The Polish catalogue loads after the choice and the header re-renders in
  // Polish. Under a full parallel run the click below once landed mid-swap
  // and the dialog it opened was gone (2 XI): wait for the switch first.
  const polish = page.getByRole('button', { name: 'Zmień język' });
  await expect(polish).toBeVisible();
  // Back to English for the rest of this browser context.
  await expect(async () => {
    await polish.click();
    await page.getByRole('dialog').getByRole('button', { name: 'English' }).click({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Change Language' })).toBeVisible();
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

// A click anywhere else
// closes the list, as every popover in the app does.
test('the notification list closes on a click outside it', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const list = page.locator('#notification-popup');
  await expect(list).toBeVisible();
  await page.locator('main, body').first().click({ position: { x: 5, y: 400 } });
  await expect(list).toBeHidden();
});

// Only complete languages. A German browser used to get a
// German-English mix (686 of 1972 texts); now it gets English, and the
// language dialog offers English and Polish only.
test.describe('a device in a language Postra does not offer', () => {
  test.use({ locale: 'de-DE', extraHTTPHeaders: { 'accept-language': 'de-DE,de;q=0.9' } });

  test('gets English, and the dialog offers English and Polish', async ({ page, context }) => {
    await context.clearCookies({ name: 'i18next' });
    await page.goto('/launches');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: 'Change Language' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change Language' });
    await expect(dialog.getByRole('button', { name: 'English' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'polski' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Deutsch/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Français/ })).toHaveCount(0);
  });
});
