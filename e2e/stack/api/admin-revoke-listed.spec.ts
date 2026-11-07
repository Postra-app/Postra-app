import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { database, throwawayOrg, makeAdministrator } from '../helpers';

// Revoking a plan only soft-deletes the subscription row, and the admin
// panel's Users and Organizations lists read it without looking at
// deletedAt: the organisation still showed its old plan (e.g. "LIFETIME"),
// and "Comp a plan", offered only to organisations without one, never came
// back, so a plan taken back could not be replaced from the panel.
let prisma: PrismaClient;
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('a revoked plan is gone from the admin lists, and a comp can replace it', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 100, channels: 0 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await makeAdministrator(prisma, { api: staff.api, userId: staffUser.userId });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);
    const targetUser = await prisma.user.findFirstOrThrow({
      where: { organizations: { some: { organizationId: target.orgId } } },
    });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: target.orgId } });

    const listed = async () => {
      const users = await (await staff.api.get(`/admin/users?search=${encodeURIComponent(targetUser.email)}`)).json();
      const orgs = await (await staff.api.get(`/admin/organizations?search=${encodeURIComponent(org.name)}`)).json();
      return {
        user: users.items[0].organizations[0].organization.subscription,
        org: orgs.items[0].subscription,
      };
    };
    expect((await listed()).user?.subscriptionTier).toBe('ULTIMATE');

    const revoked = await staff.api.post('/admin/revoke-subscription', { data: { organizationId: target.orgId } });
    expect(revoked.status(), await revoked.text()).toBe(201);
    expect(await listed()).toEqual({ user: null, org: null });

    const comp = await staff.api.post('/admin/comp-subscription', {
      data: { organizationId: target.orgId, subscription: 'PRO' },
    });
    expect(comp.status(), await comp.text()).toBe(201);
    const after = await listed();
    expect(after.user?.subscriptionTier).toBe('PRO');
    expect(after.org?.subscriptionTier).toBe('PRO');
  } finally {
    await staff.remove();
    await target.remove();
  }
});

// A lifetime grant writes a marker code per organisation, and the code is
// unique: granting lifetime again after a revoke failed with a 500, so a
// lifetime plan taken back could never be given back.
test('lifetime can be granted again after it was revoked', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await makeAdministrator(prisma, { api: staff.api, userId: staffUser.userId });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);
    const targetUser = await prisma.user.findFirstOrThrow({
      where: { organizations: { some: { organizationId: target.orgId } } },
    });
    const revoke = () => staff.api.post('/admin/revoke-subscription', { data: { organizationId: target.orgId } });
    const grant = () => staff.api.post('/admin/grant-lifetime', { data: { email: targetUser.email, apply: true } });

    expect((await revoke()).status()).toBe(201);
    for (const round of [1, 2]) {
      const granted = await grant();
      expect(granted.status(), `grant ${round}: ${await granted.text()}`).toBe(201);
      expect((await granted.json()).granted).toHaveLength(1);
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: target.orgId } });
      expect(sub).toMatchObject({ isLifetime: true, subscriptionTier: 'ULTIMATE', deletedAt: null });
      expect((await revoke()).status()).toBe(201);
    }
  } finally {
    await staff.remove();
    await target.remove();
  }
});
