import { expect, test } from '@playwright/test';
import { anonymous, signedIn, makeAdministrator } from '../helpers';

// The Postra admin panel is for Postra staff (User.isSuperAdmin), not for the
// owner of an organisation — the seeded users are owners. Every admin route
// must refuse them with 403 (was 400 "Unauthorized") and without a
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

// Every route of the admin controller, as the owner of an organisation:
// refused before anything is read or changed (the admin controller is
// guarded as a whole, so a route added later is refused too).
const ADMIN_ROUTES: [string, string][] = [
  ['GET', '/admin/errors'], ['GET', '/admin/errors/platforms'], ['GET', `/admin/errors/${UNKNOWN}`],
  ['GET', '/admin/organizations'], ['GET', '/admin/metrics'], ['GET', '/admin/health'],
  ['GET', '/admin/ai-costs'], ['GET', '/admin/ai-usage'], ['GET', '/admin/growth'],
  ['GET', '/admin/subscriptions'], ['GET', '/admin/audit/actions'], ['GET', '/admin/charges'],
  ['GET', '/admin/integrations/providers'],
  ['POST', '/admin/grant-lifetime'], ['POST', '/admin/comp-subscription'], ['POST', '/admin/reset-credits'],
  ['GET', '/admin/comps'], ['POST', '/admin/pending-grants'], ['DELETE', `/admin/pending-grants/${UNKNOWN}`],
  ['POST', '/admin/revoke-subscription'], ['POST', '/admin/grant-admin'], ['POST', '/admin/refund-charges'],
  ['POST', '/admin/cancel-subscription'], ['POST', '/admin/delete-user'], ['POST', '/admin/delete-organization'],
];

test('an organisation owner is refused every admin route with 403', async () => {
  const api = await signedIn('a');
  for (const [method, path] of ADMIN_ROUTES) {
    const res = await api.fetch(path, { method, data: method === 'POST' ? { userId: UNKNOWN, organizationId: UNKNOWN } : undefined });
    expect(res.status(), `${method} ${path}`).toBe(403);
  }
  await api.dispose();
});

test('admin routes without a session are 401', async () => {
  const api = await anonymous();
  for (const path of ADMIN_READS) {
    expect((await api.get(path)).status(), path).toBe(401);
  }
  await api.dispose();
});

// A change made by an admin in a customer's name is on the audit trail with the
// real admin, the customer, the method and the path.
test('a change made while impersonating is audited with the real admin', async () => {
  const { database, throwawayOrg } = await import('../helpers');
  const prisma = database();
  const admin = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    const adminUser = (await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: admin.orgId } })).userId;
    const membership = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: target.orgId } });
    await makeAdministrator(prisma, { api: admin.api, userId: adminUser });

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
