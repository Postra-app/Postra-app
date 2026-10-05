import { expect, test } from '@playwright/test';
import { database, stateFile, throwawayOrg } from '../helpers';
import { USERS } from '../seed';

// E2E-08-34: opening an invitation link added the signed-in person at once,
// so any site could send them into its organisation, as whichever account the
// browser held. The link now asks first.

test.use({ storageState: stateFile('b') });

test('an invitation link asks before joining, and joins on "Join"', async ({ page }) => {
  const prisma = database();
  const agency = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  try {
    const res = await agency.api.post('/settings/team', {
      data: { email: USERS.b.email, role: 'USER', sendEmail: false },
    });
    expect(res.status(), await res.text()).toBe(201);
    const invite = new URL((await res.json()).url, 'https://x').searchParams.get('org')!;
    const b = await prisma.user.findFirstOrThrow({ where: { email: USERS.b.email } });
    const isMember = () =>
      prisma.userOrganization.count({ where: { userId: b.id, organizationId: agency.orgId } });

    await page.goto(`/?org=${encodeURIComponent(invite)}`);
    await expect(page).toHaveURL(/\/join\?org=/);
    await expect(page.getByRole('heading', { name: /Join Stack throwaway/ })).toBeVisible();
    await expect(page.getByText(USERS.b.email)).toBeVisible();
    expect(await isMember()).toBe(0);

    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(page).toHaveURL(/\/launches/);
    expect(await isMember()).toBe(1);
  } finally {
    await agency.remove();
    await prisma.$disconnect();
  }
});
