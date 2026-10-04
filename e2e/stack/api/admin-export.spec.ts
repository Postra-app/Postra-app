import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { database, throwawayOrg } from '../helpers';

// A subject access request answered from the admin panel (UK GDPR art. 15,
// P8): the person's data as a JSON download, with no secret in it, audited.
let prisma: PrismaClient;
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('an administrator exports one person: their data, no secrets, an audit row', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 1 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    const targetUser = await prisma.user.findFirstOrThrow({
      where: { organizations: { some: { organizationId: target.orgId } } },
    });
    await prisma.post.create({
      data: {
        organizationId: target.orgId,
        integrationId: target.channelIds[0],
        group: `export-${Date.now()}`,
        content: 'A post the export must carry',
        publishDate: new Date(Date.now() + 86_400_000),
      },
    });

    // Not for a customer, not even about themselves.
    expect((await target.api.get(`/admin/users/${targetUser.id}/export`)).status()).toBe(403);

    await prisma.user.update({ where: { id: staffUser.userId }, data: { isSuperAdmin: true } });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);

    expect((await staff.api.get('/admin/users/00000000-0000-4000-8000-000000000000/export')).status()).toBe(404);

    const res = await staff.api.get(`/admin/users/${targetUser.id}/export`);
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-disposition']).toContain('attachment');
    const data = await res.json();
    expect(data.user.email).toBe(targetUser.email);
    expect(data.organizations).toHaveLength(1);
    expect(data.organizations[0]).toMatchObject({ id: target.orgId, ownedAlone: true });
    expect(data.organizations[0].channels).toHaveLength(1);
    expect(data.organizations[0].posts[0].content).toBe('A post the export must carry');

    const raw = JSON.stringify(data);
    for (const secret of ['fake-token', targetUser.password!, 'tokenVersion', 'refreshToken', 'accessToken']) {
      expect(raw, secret).not.toContain(secret);
    }

    await expect
      .poll(() =>
        prisma.auditLog.count({ where: { action: 'admin.export-user', userId: staffUser.userId } })
      )
      .toBe(1);
  } finally {
    await staff.remove();
    await target.remove();
  }
});
