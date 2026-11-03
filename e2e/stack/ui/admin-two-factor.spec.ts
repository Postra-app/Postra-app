import { expect, Page, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';
import { totpCode, totpStep } from '../../../libraries/helpers/src/auth/totp';

// What a Postra administrator sees: /admin sends a session without the second
// step to /two-factor, the first visit sets up the authenticator and shows
// the backup codes once, a later session types a code (here a backup code).

const signIn = async (page: Page, email: string, password: string) => {
  const res = await page.context().request.post(`${BACKEND_URL}/auth/login`, {
    data: { email, password, provider: 'LOCAL' },
    headers: {
      'x-forwarded-for': `198.20.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
  expect(res.status(), await res.text()).toBe(200);
};

test('an administrator sets up the authenticator, then signs in again with a backup code', async ({
  browser,
}) => {
  const prisma = database();
  const staff = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    await prisma.user.update({ where: { id: staff.userId }, data: { isSuperAdmin: true } });

    const first = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const page = await first.newPage();
    await signIn(page, staff.email, staff.password);

    await expect
      .poll(
        async () => {
          await page.goto('/admin/stats');
          return new URL(page.url()).pathname;
        },
        { timeout: 60_000 }
      )
      .toBe('/two-factor');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/admin/stats');

    await page.getByRole('button', { name: 'Set up the authenticator' }).click();
    await expect(page.getByTestId('two-factor-qr')).toBeVisible();
    const secret = (await page.getByTestId('two-factor-secret').innerText()).trim();

    await page.getByTestId('two-factor-code').fill('000000');
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();

    await page.getByTestId('two-factor-code').fill(totpCode(secret, totpStep()));
    await page.getByRole('button', { name: 'Turn on' }).click();
    const codes = page.getByTestId('two-factor-backup-codes').locator('span');
    await expect(codes).toHaveCount(10);
    const backup = (await codes.nth(0).innerText()).trim();

    await page.getByRole('button', { name: /saved them/ }).click();
    await expect(page).toHaveURL(/\/admin\/stats$/);
    await expect(page.getByText('You do not have access to this page.')).toHaveCount(0);
    await first.close();

    // A new session: the code again, a backup code this time.
    const second = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const again = await second.newPage();
    await signIn(again, staff.email, staff.password);
    await again.goto('/admin/users');
    await expect(again).toHaveURL(/\/two-factor\?next=%2Fadmin%2Fusers$/);
    await expect(again.getByText('or one of your backup codes')).toBeVisible();
    await again.getByTestId('two-factor-code').fill(backup.toUpperCase());
    await again.getByRole('button', { name: 'Verify' }).click();
    await expect(again).toHaveURL(/\/admin\/users$/);
    await second.close();
  } finally {
    await staff.remove();
  }
});
