import { expect, test } from '@playwright/test';

// The reset and resend forms rejected on a 429 before any branch of their own
// handling ran: the reset button spun forever and the resend form said "An
// error occurred" (final app check §6, 2026-10-22). Both limits are the
// endpoints' own @Throttle (5 per 15 min, 5 per hour), mocked here.
test.use({ storageState: { cookies: [], origins: [] } });

const tooMany = {
  status: 429,
  contentType: 'application/json',
  body: JSON.stringify({
    statusCode: 429,
    message: 'ThrottlerException: Too Many Requests',
  }),
};

test('password reset over the limit says so and frees the button', async ({
  page,
}) => {
  await page.route('**/auth/forgot-return', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(tooMany)
      : route.fallback()
  );
  await page.goto('/auth/forgot/not-a-real-token');
  await page
    .getByPlaceholder('Password', { exact: true })
    .fill('Stack-tests-T-2');
  await page.getByPlaceholder('Repeat Password').fill('Stack-tests-T-2');
  const submit = page.getByRole('button', { name: 'Change Password' });
  await submit.click();
  await expect(
    page.getByText(
      'Too many attempts - please wait a few minutes and try again.'
    )
  ).toBeVisible();
  await expect(submit).toBeEnabled();
});

test('resending the activation mail over the limit says so', async ({
  page,
}) => {
  await page.route('**/auth/resend-activation', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(tooMany)
      : route.fallback()
  );
  await page.goto('/auth/activate');
  await page
    .getByPlaceholder('Email Address')
    .fill(`limit-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Resend Activation Email' }).click();
  await expect(
    page.getByText(
      'Too many attempts - please wait a few minutes and try again.'
    )
  ).toBeVisible();
});

test('a mangled activation link is called invalid, not "already activated"', async ({
  page,
}) => {
  await page.goto('/auth/activate/not-a-token');
  await expect(
    page.getByText('This activation link is invalid or has expired.')
  ).toBeVisible();
  await expect(page.getByText('already activated')).toHaveCount(0);
});

test('a signed-out visitor of a modal route gets a page with a way to sign in', async ({
  page,
}) => {
  await page.goto('/modal/anything');
  await expect(page).toHaveURL(/\/auth\/login-required/);
  await expect(
    page.getByRole('heading', { name: 'Sign in required' })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/auth/login'
  );
});
