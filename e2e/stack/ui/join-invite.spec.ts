import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// E2E-08-34: opening an invitation link added the signed-in person at once,
// so any site could send them into its organisation, as whichever account the
// browser held. The link now asks first.
//
// The invited person is a throwaway too. It used to be the shared user B: B
// then belonged to the agency until the test removed it, and a spec running
// as B at that moment wrote into an organisation about to vanish (a
// signature create failed on its foreign key, 2026-10-07).
test.use({ storageState: { cookies: [], origins: [] } });

test('an invitation link asks before joining, and joins on "Join"', async ({ page }) => {
  const prisma = database();
  const agency = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const person = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  try {
    await page.context().addCookies((await person.api.storageState()).cookies);
    const invited = await prisma.user.findFirstOrThrow({
      where: { organizations: { some: { organizationId: person.orgId } } },
    });
    const res = await agency.api.post('/settings/team', {
      data: { email: invited.email, role: 'USER', sendEmail: false },
    });
    expect(res.status(), await res.text()).toBe(201);
    const invite = new URL((await res.json()).url, 'https://x').searchParams.get('org')!;
    const isMember = () =>
      prisma.userOrganization.count({ where: { userId: invited.id, organizationId: agency.orgId } });

    await page.goto(`/?org=${encodeURIComponent(invite)}`);
    await expect(page).toHaveURL(/\/join\?org=/);
    await expect(page.getByRole('heading', { name: /Join Stack throwaway/ })).toBeVisible();
    await expect(page.getByText(invited.email)).toBeVisible();
    expect(await isMember()).toBe(0);

    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(page).toHaveURL(/\/launches/);
    expect(await isMember()).toBe(1);
  } finally {
    await agency.remove();
    await person.remove();
    await prisma.$disconnect();
  }
});

test.describe('from an organisation without a plan', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the invitation is answered before the paywall', async ({ page }) => {
    // The layout put the plan picker in place of every page for a FREE
    // organisation, so the join page never showed and the way out of a free
    // organisation — joining a paid one — was closed.
    const prisma = database();
    const agency = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
    const free = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
    await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
    try {
      await page.context().addCookies((await free.api.storageState()).cookies);
      const { email } = await prisma.user.findFirstOrThrow({
        where: { organizations: { some: { organizationId: free.orgId } } },
      });
      const res = await agency.api.post('/settings/team', { data: { email, role: 'USER', sendEmail: false } });
      const invite = new URL((await res.json()).url, 'https://x').searchParams.get('org')!;

      await page.goto(`/?org=${encodeURIComponent(invite)}`);
      await expect(page.getByRole('heading', { name: /Join Stack throwaway/ })).toBeVisible();
      await page.getByRole('button', { name: 'Join', exact: true }).click();
      await expect(page).toHaveURL(/\/launches/);
      expect(await prisma.userOrganization.count({ where: { organizationId: agency.orgId } })).toBe(2);
    } finally {
      await agency.remove();
      await free.remove();
      await prisma.$disconnect();
    }
  });
});

test('an invitation opened before logging in asks to join after the login (E2E-05-95)', async ({ page }) => {
  // Without a session the link only leaves a cookie; a password login read
  // nothing from it, so the person landed in their own calendar and the
  // invitation was lost.
  const prisma = database();
  const agency = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const person = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  try {
    const invited = await prisma.user.findFirstOrThrow({
      where: { organizations: { some: { organizationId: person.orgId } } },
    });
    const res = await agency.api.post('/settings/team', {
      data: { email: invited.email, role: 'USER', sendEmail: false },
    });
    expect(res.status(), await res.text()).toBe(201);
    const invite = new URL((await res.json()).url, 'https://x').searchParams.get('org')!;

    await page.goto(`/?org=${encodeURIComponent(invite)}`);
    await expect(page).toHaveURL(/\/auth/);
    await page.getByLabel('Email').fill(invited.email);
    await page.getByLabel('Password', { exact: true }).fill('Stack-tests-T-1');
    await page.getByRole('button', { name: /^(Sign in|Log in|Login)$/ }).click();

    await expect(page).toHaveURL(/\/join\?org=/);
    await expect(page.getByRole('heading', { name: /Join Stack throwaway/ })).toBeVisible();
  } finally {
    await agency.remove();
    await person.remove();
    await prisma.$disconnect();
  }
});
