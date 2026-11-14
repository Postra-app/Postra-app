import { expect, Page, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';
import { totpCode, totpStep } from '../../../libraries/helpers/src/auth/totp';

// Add Channel showed every customer the grey "Soon" tiles (Lemmy, LinkedIn
// Page, Google My Business...), which read as a promise. Customers now see
// only the platforms they can connect; a super admin sees every tile; the
// preview organisation (a platform reviewer's login) sees the offered ones
// plus Google Business Profile.
test.use({ storageState: { cookies: [], origins: [] } });

type Who = Awaited<ReturnType<typeof throwawayOrg>>;

const signIn = async (page: Page, who: Who) => {
  const login = await page.context().request.post(`${BACKEND_URL}/auth/login`, {
    data: { email: who.email, password: who.password, provider: 'LOCAL' },
    headers: {
      'x-forwarded-for': `198.22.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
  expect(login.status(), await login.text()).toBe(200);
};

const openPicker = async (page: Page) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Add Channel' }).first().click();
  const tile = (name: string) => page.locator('.launches-provider-card', { hasText: name });
  await expect(tile('Bluesky')).toBeVisible();
  return tile;
};

test('a customer sees only the platforms on offer, no "Soon" tile', async ({ page }) => {
  const prisma = database();
  const customer = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 1 });
  try {
    await signIn(page, customer);
    const tile = await openPicker(page);
    await expect(page.getByText('1 of 6 social accounts connected · Pro', { exact: true })).toBeVisible();
    await expect(tile('Soon')).toHaveCount(0);
    for (const name of ['Lemmy', 'LinkedIn Page', 'Google My Business']) {
      await expect(tile(name), name).toHaveCount(0);
    }
    // A working platform outside Pro stays, locked behind the upgrade.
    await expect(tile('WordPress')).toContainText('Business');
  } finally {
    await customer.remove();
    await prisma.$disconnect();
  }
});

test('the preview organisation sees Google Business Profile and no other "Soon" tile', async ({ page }) => {
  const prisma = database();
  const reviewer = await throwawayOrg(prisma, {
    tier: 'STANDARD',
    totalChannels: 3,
    channels: 0,
    // Its own id (stack.env): api/plan-limits.spec runs alongside with
    // stack-preview-org, and two organisations cannot share an id.
    id: 'stack-preview-org-ui',
  });
  try {
    await signIn(page, reviewer);
    const tile = await openPicker(page);
    await expect(tile('Google My Business')).toBeVisible();
    await expect(tile('Soon')).toHaveCount(0);
    await expect(tile('Lemmy')).toHaveCount(0);
    await expect(tile('LinkedIn Page')).toHaveCount(0);
  } finally {
    await reviewer.remove();
    await prisma.$disconnect();
  }
});

test('a super admin sees every tile, "Soon" ones included', async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = database();
  const staff = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    await prisma.user.update({ where: { id: staff.userId }, data: { isSuperAdmin: true } });
    await signIn(page, staff);
    // The flag counts only past the second step (ADMIN_TOTP_REQUIRED).
    const api = page.context().request;
    let setup: Awaited<ReturnType<typeof api.post>> | undefined;
    await expect
      .poll(async () => (setup = await api.post(`${BACKEND_URL}/two-factor/setup`)).status(), {
        timeout: 60_000,
      })
      .toBe(201);
    const { secret } = await setup!.json();
    const enabled = await api.post(`${BACKEND_URL}/two-factor/enable`, {
      data: { code: totpCode(secret, totpStep()) },
    });
    expect(enabled.status(), await enabled.text()).toBe(201);

    const tile = await openPicker(page);
    await expect(tile('Lemmy')).toContainText('Soon');
    await expect(tile('LinkedIn Page')).toContainText('Soon');
    await expect(tile('Google My Business')).toContainText('Preview, admin only');
  } finally {
    await staff.remove();
    await prisma.$disconnect();
  }
});
