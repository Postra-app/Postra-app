import { expect, test } from '@playwright/test';
import { sign } from 'jsonwebtoken';
import { database, throwawayOrg } from '../helpers';

// The activation link opened in a browser that did not sign up (the mail read
// on another device): the page asks for the password chosen at sign-up, which
// activates the account and signs in, instead of asking for a new one. Who did
// not sign up can still choose a new password from the same page.
test.use({ storageState: { cookies: [], origins: [] } });

// Sign-in allows 5 attempts per address. In a full run every browser test
// signs in from the same one, and this test met "Too many attempts";
// its own address, like throwawayOrg's API client.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `198.22.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
  });
});

const linkFor = (u: { id: string; email: string }) =>
  sign(
    { id: u.id, email: u.email, activated: false, purpose: 'activate' },
    process.env.JWT_SECRET!
  );

test('the sign-up password finishes the activation and signs in', async ({
  page,
}) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, {
    tier: 'PRO',
    totalChannels: 3,
    channels: 0,
  });
  try {
    const { userId } = await prisma.userOrganization.findFirstOrThrow({
      where: { organizationId: org.orgId },
    });
    const user = await prisma.user.update({
      where: { id: userId },
      data: { activated: false },
    });
    await page.goto(`/auth/activate/${linkFor(user)}`);
    await expect(
      page.getByRole('heading', { name: 'Email confirmed' })
    ).toBeVisible();
    await expect(page.locator('input[name="email"]')).toHaveValue(user.email);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).activated).toBe(false);

    await page.getByPlaceholder('Password').fill('Not-the-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page.getByText('That is not the password you signed up with', { exact: false })
    ).toBeVisible();

    await page.getByPlaceholder('Password').fill('Stack-tests-T-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/\/auth\//, { timeout: 20_000 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).activated).toBe(true);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

test('someone who did not sign up chooses a new password from the same page', async ({
  page,
}) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, {
    tier: 'PRO',
    totalChannels: 3,
    channels: 0,
  });
  try {
    const { userId } = await prisma.userOrganization.findFirstOrThrow({
      where: { organizationId: org.orgId },
    });
    const user = await prisma.user.update({
      where: { id: userId },
      data: { activated: false },
    });
    await page.goto(`/auth/activate/${linkFor(user)}`);
    await page
      .getByRole('button', { name: "I didn't sign up, or forgot my password" })
      .click();
    await expect(page).toHaveURL(/\/auth\/forgot\/.+confirmed=1/);
    await expect(
      page.getByRole('heading', { name: 'Choose your password' })
    ).toBeVisible();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).activated).toBe(true);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
