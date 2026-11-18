import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { database, throwawayOrg, makeAdministrator } from '../helpers';

// Deleting an organization from the admin panel: never one the admin belongs
// to (it would take their panel and leave their session failing), and a
// customer's organization still goes.
let prisma: PrismaClient;
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('an admin cannot delete their own organization, but can delete a customer one', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await makeAdministrator(prisma, { api: staff.api, userId: staffUser.userId });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);

    const own = await staff.api.post('/admin/delete-organization', { data: { organizationId: staff.orgId } });
    expect(own.status()).toBe(400);
    expect(await own.text()).toContain('You are a member of this organization');
    expect(await prisma.organization.findUnique({ where: { id: staff.orgId } }), 'own organization kept').toBeTruthy();
    expect((await staff.api.get('/user/self')).status()).toBe(200);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'admin.delete-organization', organizationId: staff.orgId } })
    ).toBeNull();

    const other = await staff.api.post('/admin/delete-organization', { data: { organizationId: target.orgId } });
    expect(other.status(), await other.text()).toBe(201);
    expect(await prisma.organization.findUnique({ where: { id: target.orgId } })).toBeNull();
  } finally {
    await staff.remove();
    await target.remove().catch(() => undefined);
  }
});
