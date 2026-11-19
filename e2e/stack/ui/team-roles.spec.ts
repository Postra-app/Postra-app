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

    // Admin → User: they saw the key, so it is replaced. It asks first (it
    // happened at once); "Cancel" leaves them an admin.
    const keyBefore = await apiKeyHash();
    await memberRole.selectOption('USER');
    const question = page.getByRole('dialog').filter({ hasText: 'Make this admin a user?' });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(memberRole).toHaveValue('ADMIN');
    expect(await roleOf(member.userId)).toBe('ADMIN');
    expect(await apiKeyHash()).toBe(keyBefore);
    await memberRole.selectOption('USER');
    await question.getByRole('button', { name: 'Make user' }).click();
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

// "Copy Link" clicked twice made two invitations; nothing said how long the
// link works (an hour then, a week now).
test('a double click on Copy Link makes one invitation, and the window says how long it works', async ({
  page,
  context,
  browserName,
}) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  await context.clearCookies();
  await context.addCookies((await org.api.storageState()).cookies);
  // Only Chromium knows these permission names; Firefox and WebKit allow a
  // clipboard write from a click without them and throw on the grant.
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  try {
    let invites = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/settings/team')) invites += 1;
    });
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Teams', exact: true }).click();
    await page.getByRole('button', { name: 'Add another member' }).click();
    const form = page.getByRole('dialog', { name: 'Add Member' });
    await expect(form.getByText('The link works for 7 days.')).toBeVisible();
    await form.getByRole('checkbox', { name: 'Send invitation via email?' }).click();
    await form.getByRole('combobox', { name: 'Role' }).selectOption('USER');
    await form.getByRole('button', { name: 'Copy Link' }).dblclick();
    await expect(page.getByText('Link copied to clipboard')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(invites).toBe(1);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

// Two members called Jan were two identical "Jan" rows: the full address
// tells them apart.
test('each member row shows the full email address', async ({ page, context }) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const first = await addMember(prisma, org.orgId, 'USER');
  const second = await addMember(prisma, org.orgId, 'USER');
  await context.clearCookies();
  await context.addCookies((await org.api.storageState()).cookies);
  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Teams', exact: true }).click();
    await expect(page.getByText(first.email, { exact: true })).toBeVisible();
    await expect(page.getByText(second.email, { exact: true })).toBeVisible();
  } finally {
    await first.remove();
    await second.remove();
    await org.remove();
    await prisma.$disconnect();
  }
});
