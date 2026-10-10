import { expect, test } from '@playwright/test';
import { anonymous, signedIn } from '../helpers';

// The Postra admin panel is for Postra staff (User.isSuperAdmin), not for the
// owner of an organisation — the seeded users are owners. Every admin route
// must refuse them with 403 (E2E-09-63: was 400 "Unauthorized") and without a
// session with 401.

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const ADMIN_READS = [
  '/admin/stats',
  '/admin/users',
  '/admin/audit',
  '/admin/integrations',
  `/admin/problem-reports/${UNKNOWN}.png`,
  `/admin/users/${UNKNOWN}/export`,
  '/announcements/list',
  `/user/impersonate?name=owner`,
];

test('an organisation owner is refused every admin read with 403', async () => {
  const api = await signedIn('a');
  for (const path of ADMIN_READS) {
    expect((await api.get(path)).status(), path).toBe(403);
  }
  await api.dispose();
});

test('an organisation owner cannot announce, delete announcements or grant plans', async () => {
  const api = await signedIn('a');
  expect(
    (
      await api.post('/announcements', {
        data: { title: 'Stack test', description: 'Must not be posted', color: 'INFO' },
      })
    ).status()
  ).toBe(403);
  expect((await api.delete(`/announcements/${UNKNOWN}`)).status()).toBe(403);
  expect((await api.post('/admin/suspend-user', { data: { userId: UNKNOWN, value: true } })).status()).toBe(403);
  expect(
    (
      await api.post('/billing/add-subscription', {
        data: { subscription: 'PRO' },
      })
    ).status()
  ).toBe(403);
  await api.dispose();
});

test('admin routes without a session are 401', async () => {
  const api = await anonymous();
  for (const path of ADMIN_READS) {
    expect((await api.get(path)).status(), path).toBe(401);
  }
  await api.dispose();
});

// K25 (10-10): a change made by an admin in a customer's name is on the audit
// trail with the real admin, the customer, the method and the path.
test('a change made while impersonating is audited with the real admin', async () => {
  const { database, throwawayOrg } = await import('../helpers');
  const prisma = database();
  const admin = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    const adminUser = (await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: admin.orgId } })).userId;
    const membership = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: target.orgId } });
    await prisma.user.update({ where: { id: adminUser }, data: { isSuperAdmin: true } });

    const res = await admin.api.delete(`/posts/${UNKNOWN}`, { headers: { impersonate: membership.id } });
    expect(res.status()).toBeLessThan(500);

    await expect
      .poll(() =>
        prisma.auditLog.findFirst({
          where: { action: 'admin.impersonated.request', userId: adminUser },
          orderBy: { createdAt: 'desc' },
        })
      )
      .toMatchObject({
        metadata: { method: 'DELETE', path: `/posts/${UNKNOWN}`, impersonatedUserId: membership.userId },
      });
  } finally {
    await admin.remove();
    await target.remove();
    await prisma.$disconnect();
  }
});
