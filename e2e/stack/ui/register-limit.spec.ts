import { expect, test } from '@playwright/test';

// A sign-up over the per-IP daily limit printed
// "Unexpected error: FetchHandledError: Request handled globally (status 429)"
// under the e-mail field and left the button spinning.
test.use({ storageState: { cookies: [], origins: [] } });

test('a sign-up over the daily limit says so and frees the button', async ({ page }) => {
  await page.route('**/auth/register', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' }),
        })
      : route.fallback()
  );
  await page.goto('/auth/register');
  await page.getByPlaceholder('Email Address').fill(`limit-${Date.now()}@example.com`);
  await page.getByPlaceholder('Password', { exact: true }).fill('Stack-tests-T-1');
  await page.getByPlaceholder('Company').fill('Stack sign-up limit');
  await page.getByRole('checkbox', { name: /I accept the Terms of Service/ }).click();
  const submit = page.getByRole('button', { name: 'Create Account' });
  await submit.click();

  await expect(
    page.getByText('Too many sign-ups from this network today. Please try again tomorrow or email hello@postra.co.uk.')
  ).toBeVisible();
  await expect(page.getByText(/Unexpected error|FetchHandledError/)).toHaveCount(0);
  await expect(submit).toBeEnabled();
});

// One password field, with the eye to check what was typed: a second
// "confirm" field asked for the same password twice.
test('the sign-up form asks for the password once', async ({ page }) => {
  await page.goto('/auth/register');
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
  await expect(page.getByPlaceholder('Confirm Password')).toHaveCount(0);
});
