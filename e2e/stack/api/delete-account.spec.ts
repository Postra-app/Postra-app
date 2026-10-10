import { expect, test } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { anonymous, database, throwawayOrg } from '../helpers';

// Settings → Global → Delete account (GDPR erasure, Meta data deletion): the
// user and every organisation they own alone go; an organisation they share
// with someone else stays, without them.

const PASSWORD = 'Stack-tests-T-1';

const ownerOf = async (prisma: ReturnType<typeof database>, organizationId: string) =>
  (
    await prisma.userOrganization.findFirstOrThrow({
      where: { organizationId },
      include: { user: true },
    })
  ).user;

test('deleting the account removes the user and the organisation they own alone', async () => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const { email } = await ownerOf(prisma, owner.orgId);
  try {
    const res = await owner.api.post('/user/delete');
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['logout']).toBe('true');

    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(await prisma.organization.count({ where: { id: owner.orgId } })).toBe(0);
    expect(await prisma.integration.count({ where: { organizationId: owner.orgId } })).toBe(0);

    // The session it had is dead, and the password no longer signs in.
    expect((await owner.api.get('/user/self')).status()).not.toBe(200);
    const login = await (await anonymous()).post('/auth/login', {
      data: { email, password: PASSWORD, provider: 'LOCAL' },
      headers: { 'x-forwarded-for': '198.19.0.1' },
    });
    expect(login.status()).not.toBe(200);
  } finally {
    await owner.remove();
    await prisma.$disconnect();
  }
});

test('an organisation shared with another member survives, without the deleted user', async () => {
  const prisma = database();
  const keeper = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const leaver = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const leaverUser = await ownerOf(prisma, leaver.orgId);
  await prisma.userOrganization.create({
    data: { userId: leaverUser.id, organizationId: keeper.orgId, role: 'ADMIN' },
  });
  try {
    expect((await leaver.api.post('/user/delete')).status()).toBe(200);

    expect(await prisma.organization.count({ where: { id: leaver.orgId } })).toBe(0);
    expect(await prisma.organization.count({ where: { id: keeper.orgId } })).toBe(1);
    expect(await prisma.integration.count({ where: { organizationId: keeper.orgId } })).toBe(1);
    expect(
      await prisma.userOrganization.count({ where: { organizationId: keeper.orgId } })
    ).toBe(1);
    expect((await keeper.api.get('/user/self')).status()).toBe(200);
  } finally {
    await keeper.remove();
    await leaver.remove();
    await prisma.$disconnect();
  }
});

// E2E-09-66: a platform grant is the person's whole login. While another
// organisation still uses the same Facebook login, deleting this account
// must keep the grant (and must not call Facebook at all).
test('deleting the account keeps a Facebook grant another organisation still uses', async () => {
  const prisma = database();
  const leaver = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const keeper = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const login = `fb-user-${Date.now()}`;
  for (const [org, page] of [[leaver.orgId, 'a'], [keeper.orgId, 'b']]) {
    await prisma.integration.create({
      data: {
        internalId: `${login}-page-${page}`,
        rootInternalId: login,
        organizationId: org,
        name: `Page ${page}`,
        providerIdentifier: 'facebook',
        type: 'social',
        token: 'page-token',
        refreshToken: 'user-token',
      },
    });
  }
  const log = join(__dirname, '..', '.logs', 'backend.log');
  const before = readFileSync(log, 'utf8').length;
  try {
    expect((await leaver.api.post('/user/delete')).status()).toBe(200);
    await expect
      .poll(() => readFileSync(log, 'utf8').slice(before), { timeout: 10_000 })
      .toContain('[revoke] meta: kept, the account is still connected elsewhere');
    expect(
      await prisma.integration.count({ where: { rootInternalId: login, deletedAt: null } })
    ).toBe(1);
  } finally {
    await leaver.remove();
    await keeper.remove();
    await prisma.$disconnect();
  }
});

// E2E-05-93 (K. 2026-10-10: hand the organisation on): the owner deleting
// their account left a team nobody could manage — no owner for members or
// billing. The longest-standing admin (or, without one, member) takes over.
// Upstream d6f881a89: members who are switched off do not count — an
// organisation left with only them goes with the account.
test('the owner leaving hands the organisation to the oldest admin', async () => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const userMember = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const adminMember = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const userOf = async (orgId: string) =>
    (await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: orgId } })).userId;
  const asUser = await userOf(userMember.orgId);
  const asAdmin = await userOf(adminMember.orgId);
  await prisma.userOrganization.create({ data: { userId: asUser, organizationId: owner.orgId, role: 'USER', createdAt: new Date(Date.now() - 86_400_000) } });
  await prisma.userOrganization.create({ data: { userId: asAdmin, organizationId: owner.orgId, role: 'ADMIN' } });
  try {
    expect((await owner.api.post('/user/delete')).status()).toBe(200);
    expect(await prisma.organization.count({ where: { id: owner.orgId } })).toBe(1);
    const roles = await prisma.userOrganization.findMany({ where: { organizationId: owner.orgId }, select: { userId: true, role: true } });
    expect(roles.find((r) => r.userId === asAdmin)?.role).toBe('SUPERADMIN');
    expect(roles.find((r) => r.userId === asUser)?.role).toBe('USER');
  } finally {
    await owner.remove();
    await userMember.remove();
    await adminMember.remove();
    await prisma.$disconnect();
  }
});

test('an organisation left with only switched-off members goes with the account', async () => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const off = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const offUser = (await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: off.orgId } })).userId;
  await prisma.userOrganization.create({ data: { userId: offUser, organizationId: owner.orgId, role: 'USER', disabled: true } });
  try {
    expect((await owner.api.post('/user/delete')).status()).toBe(200);
    expect(await prisma.organization.count({ where: { id: owner.orgId } })).toBe(0);
    expect(await prisma.user.count({ where: { id: offUser } })).toBe(1);
  } finally {
    await owner.remove();
    await off.remove();
    await prisma.$disconnect();
  }
});
