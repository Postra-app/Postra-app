import { expect, test } from '@playwright/test';

// Enter pressed again while the first request was out sent it again: three
// sign-in attempts for three presses (eating the login limit), and a second
// sign-up answered "Email already exists" after the first had worked.
// The shared Button is disabled while it loads.
test.use({ storageState: { cookies: [], origins: [] } });

test('pressing Enter three times while signing in sends one request', async ({ page }) => {
  const logins: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/auth/login', async (route) => {
    logins.push(route.request().method());
    await held;
    await route.fulfill({ status: 400, body: 'Invalid user name or password' });
  });
  await page.goto('/auth/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('Wrong-password-1');
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await expect.poll(() => logins.length).toBe(1);
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await page.waitForTimeout(500);
  release();
  await expect(page.getByText('Invalid user name or password')).toBeVisible();
  expect(logins).toEqual(['POST']);
});
