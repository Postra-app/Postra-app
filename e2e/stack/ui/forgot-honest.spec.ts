import { expect, test } from '@playwright/test';

// 3 XI 2026: someone typed an address with no Postra account and was told
// "we have sent you an email". The form now says what happened. The
// answers are mocked here; the backend's three outcomes have their own
// Jest test (auth.activation-mail.spec.ts).
const answer = (body: object) => ({
  status: 201,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test.describe('forgot password says what happened', () => {
  test('no account with this address', async ({ page }) => {
    await page.route('**/auth/forgot', (route) =>
      route.fulfill(answer({ forgot: false, reason: 'no_account' }))
    );
    await page.goto('/auth/forgot');
    await page.getByPlaceholder('Email Address').fill('nobody@example.com');
    await page.getByRole('button', { name: 'Send Password Reset Email' }).click();
    await expect(page.getByTestId('forgot-problem')).toContainText(
      'There is no Postra account with this email address.'
    );
    await expect(page.getByText('We have sent you an email')).toHaveCount(0);
  });

  test('an account that signs in with Google', async ({ page }) => {
    await page.route('**/auth/forgot', (route) =>
      route.fulfill(answer({ forgot: false, reason: 'provider', provider: 'GOOGLE' }))
    );
    await page.goto('/auth/forgot');
    await page.getByPlaceholder('Email Address').fill('someone@gmail.com');
    await page.getByRole('button', { name: 'Send Password Reset Email' }).click();
    await expect(page.getByTestId('forgot-problem')).toContainText(
      'This account signs in with Google'
    );
    await expect(page.getByText('We have sent you an email')).toHaveCount(0);
  });

  test('a mail that could not be sent is an error, not "sent"', async ({ page }) => {
    await page.route('**/auth/forgot', (route) =>
      route.fulfill(answer({ forgot: false, reason: 'send_failed' }))
    );
    await page.goto('/auth/forgot');
    await page.getByPlaceholder('Email Address').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send Password Reset Email' }).click();
    await expect(page.getByText('Could not send the reset email')).toBeVisible();
    await expect(page.getByText('We have sent you an email')).toHaveCount(0);
  });

  test('sent says sent', async ({ page }) => {
    await page.route('**/auth/forgot', (route) => route.fulfill(answer({ forgot: true })));
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
