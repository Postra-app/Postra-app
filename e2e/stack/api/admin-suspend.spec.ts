import { expect, request as pwRequest, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// Suspending an account from the admin panel (P7, before opening sign-ups):
// every session ends at once, signing in is refused with a plain reason, and
// lifting the suspension lets the person back in.
let prisma: PrismaClient;
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

const signIn = async (email: string) => {
  const api = await pwRequest.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: { 'x-forwarded-for': `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
  });
  const res = await api.post('/auth/login', { data: { email, password: 'Stack-tests-T-1', provider: 'LOCAL' } });
  return { api, res };
};

test('a suspended user is signed out everywhere and cannot sign in until it is lifted', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await prisma.user.update({ where: { id: staffUser.userId }, data: { isSuperAdmin: true } });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);
    const targetUser = await prisma.user.findFirstOrThrow({
      where: { organizations: { some: { organizationId: target.orgId } } },
    });
    expect((await target.api.get('/user/self')).status()).toBe(200);

    // Not yourself, not another administrator.
    expect((await staff.api.post('/admin/suspend-user', { data: { userId: staffUser.userId, value: true } })).status()).toBe(400);

    const suspend = await staff.api.post('/admin/suspend-user', {
      data: { userId: targetUser.id, value: true, reason: 'Stack test: spam' },
    });
    expect(suspend.status(), await suspend.text()).toBe(201);

    // The open session dies on its next request.
    // 401, as after a password reset: the session is gone.
    expect((await target.api.get('/user/self')).status()).toBe(401);
    const again = await signIn(targetUser.email);
    expect(again.res.status()).toBe(400);
    expect(await again.res.text()).toContain('This account is suspended');
    await again.api.dispose();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: targetUser.id } });
    expect(row.suspendedReason).toBe('Stack test: spam');
    expect(row.tokenVersion).toBe(targetUser.tokenVersion + 1);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'admin.suspend-user', userId: staffUser.userId } });
    expect(audit, 'audit row').toBeTruthy();

    const listed = await (await staff.api.get(`/admin/users?search=${encodeURIComponent(targetUser.email)}`)).json();
    expect(listed.items[0].suspendedAt).toBeTruthy();

    expect((await staff.api.post('/admin/suspend-user', { data: { userId: targetUser.id, value: false } })).status()).toBe(201);
    const back = await signIn(targetUser.email);
    expect(back.res.status(), await back.res.text()).toBe(200);
    await back.api.dispose();
  } finally {
    await staff.remove();
    await target.remove();
  }
});
