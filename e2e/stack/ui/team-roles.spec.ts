import { expect, test } from '@playwright/test';
import { addMember, database, throwawayOrg } from '../helpers';

// In the browser: Settings → Teams lets the owner change a member's
// role and hand the organisation over. Taking an admin's role or removing
// them replaces the API key they could see, at once, and says so. Its own
// organisation: roles change.

test('the owner changes roles, the key is replaced after an admin, and the organisation is handed over', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const member = await addMember(prisma, org.orgId, 'USER');
  const admin = await addMember(prisma, org.orgId, 'ADMIN');
  const roleOf = async (userId: string) =>
    (
      await prisma.userOrganization.findUnique({
        where: { userId_organizationId: { userId, organizationId: org.orgId } },
      })
    )?.role;
  const apiKeyHash = async () =>
    (await prisma.organization.findUnique({ where: { id: org.orgId } }))?.apiKeyHash;
  await context.clearCookies();
  await context.addCookies((await org.api.storageState()).cookies);
  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Teams', exact: true }).click();
    const memberRow = page.locator('div.flex.items-center', {
      has: page.locator(`select[aria-label="Role of ${member.email}"]`),
    });
    const memberRole = page.getByLabel(`Role of ${member.email}`);
    await expect(memberRole).toHaveValue('USER');

    // User → Admin: no question, applied at once.
    await memberRole.selectOption('ADMIN');
    await expect(page.getByText('Role changed').first()).toBeVisible();
    await expect.poll(() => roleOf(member.userId)).toBe('ADMIN');

    // Admin → User: they saw the key, so it is replaced and the page says so.
    const keyBefore = await apiKeyHash();
    await memberRole.selectOption('USER');
    await expect(
      page.getByText('They could see your API key, so it was replaced.', { exact: false })
    ).toBeVisible();
    await expect.poll(() => roleOf(member.userId)).toBe('USER');
    await expect.poll(() => apiKeyHash()).not.toBe(keyBefore);
    const keyAfterDemotion = await apiKeyHash();

    // Removing an admin: warned before confirming, and the key is replaced again.
    const adminRow = page.locator('div.flex.items-center', {
      has: page.locator(`select[aria-label="Role of ${admin.email}"]`),
    });
    await adminRow.getByRole('button', { name: 'Remove' }).click();
    await expect(
      page.getByText('They could see your API key, so it will be replaced', { exact: false })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Yes, delete it!' }).click();
    await expect(
      page.getByText('They could see your API key, so it was replaced.', { exact: false }).first()
    ).toBeVisible();
    await expect.poll(() => apiKeyHash()).not.toBe(keyAfterDemotion);

    // Hand the organisation over: the member becomes the owner, I stay an admin
    // and the role controls go away.
    await memberRow.getByRole('button', { name: 'Make owner' }).click();
    await expect(page.getByText('You stay on as an admin.')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Make owner' }).click();
    await expect(page.getByText('Ownership handed over')).toBeVisible();
    await expect.poll(() => roleOf(member.userId)).toBe('SUPERADMIN');
    expect(await roleOf(org.userId)).toBe('ADMIN');
    await expect(page.locator('select[aria-label^="Role of"]')).toHaveCount(0);
  } finally {
    await member.remove();
    await admin.remove();
    await org.remove();
    await prisma.$disconnect();
  }
});
