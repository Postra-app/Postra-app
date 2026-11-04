import { expect, test, type Page } from '@playwright/test';

// The forgot-password form says what happened instead of always "we have
// sent you an email". The answers are mocked here; the backend's outcomes
// have their own Jest test (auth.activation-mail.spec.ts).

// Signed out: a signed-in visit to /auth/* goes to the calendar.
test.use({ storageState: { cookies: [], origins: [] } });

// Only the form's POST to the API; the page itself must load.
const mockForgot = (page: Page, body: object) =>
  page.route('**/api/auth/forgot', (route) =>
    route.request().method() === 'POST' ? route.fulfill(answer(body)) : route.continue()
  );
const answer = (body: object) => ({
  status: 201,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test.describe('forgot password says what happened', () => {
  test('no account with this address', async ({ page }) => {
    await mockForgot(page, { forgot: false, reason: 'no_account' });
    await page.goto('/auth/forgot');
    await page.getByPlaceholder('Email Address').fill('nobody@example.com');
    await page.getByRole('button', { name: 'Send Password Reset Email' }).click();
    await expect(page.getByTestId('forgot-problem')).toContainText(
      'There is no Postra account with this email address.'
    );
    await expect(page.getByText('We have sent you an email')).toHaveCount(0);
  });

  test('an account that signs in with Google', async ({ page }) => {
    await mockForgot(page, { forgot: false, reason: 'provider', provider: 'GOOGLE' });
    await page.goto('/auth/forgot');
    await page.getByPlaceholder('Email Address').fill('someone@gmail.com');
    await page.getByRole('button', { name: 'Send Password Reset Email' }).click();
    await expect(page.getByTestId('forgot-problem')).toContainText(
      'This account signs in with Google'
    );
    await expect(page.getByText('We have sent you an email')).toHaveCount(0);
  });

  test('a mail that could not be sent is an error, not "sent"', async ({ page }) => {
    await mockForgot(page, { forgot: false, reason: 'send_failed' });
    await page.goto('/auth/forgot');
    await page.getByPlaceholder('Email Address').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send Password Reset Email' }).click();
    await expect(page.getByText('Could not send the reset email')).toBeVisible();
    await expect(page.getByText('We have sent you an email')).toHaveCount(0);
  });

  test('sent says sent', async ({ page }) => {
    await mockForgot(page, { forgot: true });
    await page.goto('/auth/forgot');
    await page.getByPlaceholder('Email Address').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send Password Reset Email' }).click();
    await expect(page.getByText('We have sent you an email')).toBeVisible();
  });
});

// Sign-in with Google is on the login page whether sign-ups are open or not.
test('the login page offers Google sign-in', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByText('Continue With')).toBeVisible();
  await expect(page.getByText('Google', { exact: true })).toBeVisible();
});
