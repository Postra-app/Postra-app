import { expect, test } from '@playwright/test';

// The page a visitor lands on coming back from Google without a Postra
// account. The backend's answer is stubbed (there is no Google on the stack);
// the page is the built frontend.
test.use({ storageState: { cookies: [], origins: [] } });

const back = '/auth/register?provider=google&code=stub-code&state=stub-state';
const answer = (page: import('@playwright/test').Page, body: object) =>
  page.route('**/auth/oauth/GOOGLE/exists', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(body) })
  );

for (const size of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`a new person is told Google worked and what is left to do (${size.name})`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    await answer(page, { token: 'stub-token', canRegister: true, email: 'new.person@example.com' });
    await page.goto(back);
    await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible();
    await expect(page.getByTestId('after-provider-note')).toHaveText(
      'You are signed in with Google as new.person@example.com. You do not have a Postra account yet: add your company name and accept the terms to create one.'
    );
    await expect(page.getByText('Continue With')).toHaveCount(0);
    await expect(page.getByPlaceholder('Company')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign In' }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`after-google-new-${size.name}.png`), fullPage: true });
  });
}

test('an address with a password account is sent to sign in', async ({ page }, testInfo) => {
  await answer(page, { passwordAccount: true });
  await page.goto(back);
  await expect(page.getByTestId('provider-sign-in-failed')).toContainText(
    'This email already has a Postra account with a password. Sign in with your email and password instead.'
  );
  await expect(page.getByRole('heading', { name: 'One more step' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('after-google-password-account.png'), fullPage: true });
});
