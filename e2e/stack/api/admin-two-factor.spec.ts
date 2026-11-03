import { expect, test } from '@playwright/test';
import { database, makeAdministrator, throwawayOrg } from '../helpers';
import { totpCode, totpStep } from '../../../libraries/helpers/src/auth/totp';

// A Postra administrator can act as every customer. The password alone used
// to open all of it; now the administrator flag needs an authenticator code
// in the session (backend admin-mfa.ts). Real backend, real database.

test('a password-only administrator session gets none of the admin powers', async () => {
  const prisma = database();
  const staff = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    await prisma.user.update({ where: { id: staff.userId }, data: { isSuperAdmin: true } });
    await expect
      .poll(async () => (await (await staff.api.get('/user/self')).json()).adminMfaPending, {
        timeout: 60_000,
      })
      .toBe(true);

    const self = await (await staff.api.get('/user/self')).json();
    expect(self).toMatchObject({ isSuperAdmin: false, admin: false, adminMfaPending: true });
    expect((await staff.api.get('/admin/stats')).status()).toBe(403);
    expect((await staff.api.get('/admin/users')).status()).toBe(403);

    // Impersonation does not happen: the session stays the administrator's own.
    const membership = await prisma.userOrganization.findFirstOrThrow({
      where: { organizationId: target.orgId },
    });
    const asTarget = await staff.api.get('/user/self', { headers: { impersonate: membership.id } });
    expect((await asTarget.json()).id).toBe(staff.userId);

    expect(await (await staff.api.get('/two-factor')).json()).toEqual({
      required: true,
      enabled: false,
      verified: false,
      backupCodesLeft: 0,
    });
  } finally {
    await staff.remove();
    await target.remove();
  }
});

test('the code opens the panel; a used code, a wrong code and re-enrolment do not', async () => {
  const prisma = database();
  const staff = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    const { secret, backupCodes } = await makeAdministrator(prisma, staff);
    expect(backupCodes).toHaveLength(10);
    expect((await staff.api.get('/admin/stats')).status()).toBe(200);

    const row = await prisma.userTotp.findUniqueOrThrow({ where: { userId: staff.userId } });
    expect(row.secret.startsWith('enc2::')).toBe(true);
    expect(row.secret).not.toContain(secret);
    expect(row.backupCodes).not.toContain(backupCodes[0]);

    // With the authenticator on, the password alone cannot swap it.
    expect((await staff.api.post('/two-factor/setup')).status()).toBe(409);

    // A new sign-in starts without the second step.
    const fresh = await throwawayLogin(staff.email, staff.password);
    expect((await fresh.get('/admin/stats')).status()).toBe(403);
    // The code that turned it on was used already.
    const used = await fresh.post('/two-factor/verify', {
      data: { code: totpCode(secret, row.lastStep!) },
    });
    expect(used.status()).toBe(400);
    // A backup code works once.
    expect(
      (await fresh.post('/two-factor/verify', { data: { code: backupCodes[0] } })).status()
    ).toBe(201);
    expect((await fresh.get('/admin/stats')).status()).toBe(200);

    const again = await throwawayLogin(staff.email, staff.password);
    expect(
      (await again.post('/two-factor/verify', { data: { code: backupCodes[0] } })).status()
    ).toBe(400);

    const audit = await prisma.auditLog.findMany({
      where: { userId: staff.userId, action: { startsWith: 'admin.mfa.' } },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['admin.mfa.setup', 'admin.mfa.enabled', 'admin.mfa.backup-code', 'admin.mfa.failed'])
    );
    await fresh.dispose();
    await again.dispose();
  } finally {
    await staff.remove();
  }
});

test('five wrong codes stop the second step, even for the right code', async () => {
  const prisma = database();
  const staff = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    const { secret } = await makeAdministrator(prisma, staff);
    const fresh = await throwawayLogin(staff.email, staff.password);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await fresh.post('/two-factor/verify', { data: { code: '000000' } })).status());
    }
    expect(statuses).toEqual([400, 400, 400, 400, 429]);
    const right = await fresh.post('/two-factor/verify', {
      data: { code: totpCode(secret, totpStep() + 1) },
    });
    expect(right.status()).toBe(429);
    expect((await fresh.get('/admin/stats')).status()).toBe(403);
    await fresh.dispose();
  } finally {
    await staff.remove();
  }
});

test('an ordinary member cannot use the second step at all', async () => {
  const prisma = database();
  const member = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    expect((await member.api.post('/two-factor/setup')).status()).toBe(403);
    expect(
      (await member.api.post('/two-factor/verify', { data: { code: '123456' } })).status()
    ).toBe(403);
    expect((await (await member.api.get('/two-factor')).json()).required).toBe(false);
  } finally {
    await member.remove();
  }
});

// Another sign-in of the same account, from its own address (sign-in is
// capped per address).
async function throwawayLogin(email: string, password: string) {
  const { request } = await import('@playwright/test');
  const { BACKEND_URL } = await import('../helpers');
  const api = await request.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: {
      'x-forwarded-for': `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
  const res = await api.post('/auth/login', { data: { email, password, provider: 'LOCAL' } });
  expect(res.status(), await res.text()).toBe(200);
  return api;
}
