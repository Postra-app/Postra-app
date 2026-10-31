import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// A plan changed by an admin (a comp, or a revoke back to FREE) left the
// channels the new plan does not include switched on; only a Stripe change
// switched them off.
const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('an admin plan change switches off the channels the new plan does not have', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 10, channels: 0 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await prisma.user.update({ where: { id: staffUser.userId }, data: { isSuperAdmin: true } });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);

    // Oldest first, so the Starter cap of 3 is not what switches them off.
    const providers = ['facebook', 'linkedin', 'x', 'discord', 'youtube'];
    for (const [n, provider] of providers.entries()) {
      const id = `admin-plan-${target.orgId}-${provider}`;
      await prisma.integration.create({
        data: {
          id,
          internalId: `${id}-internal`,
          organizationId: target.orgId,
          name: `Throwaway ${provider}`,
          providerIdentifier: provider,
          type: 'social',
          token: 'fake-token',
          profile: id,
          createdAt: new Date(Date.now() - (10 - n) * 86_400_000),
        },
      });
    }
    const enabled = async () =>
      (
        await prisma.integration.findMany({
          where: { organizationId: target.orgId, deletedAt: null, disabled: false },
          orderBy: { createdAt: 'asc' },
        })
      ).map((i) => i.providerIdentifier);
    expect(await enabled()).toEqual(providers);

    // Business -> Starter: X and Discord are Business only, YouTube is Pro.
    const toStarter = await staff.api.post('/admin/comp-subscription', {
      data: { organizationId: target.orgId, subscription: 'STANDARD' },
    });
    expect(toStarter.status(), await toStarter.text()).toBe(201);
    expect(await enabled()).toEqual(['facebook', 'linkedin']);

    // Back to FREE (Starter's platforms, 3 channels): nothing outside them
    // comes back on.
    const revoke = await staff.api.post('/admin/revoke-subscription', { data: { organizationId: target.orgId } });
    expect(revoke.status(), await revoke.text()).toBe(201);
    expect(await enabled()).toEqual(['facebook', 'linkedin']);
  } finally {
    await target.remove();
    await staff.remove();
  }
});
