import { expect, request as pwRequest, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { BACKEND_URL, database, makeAdministrator, throwawayOrg } from '../helpers';

// Influencers get Pro for a while in return for posts. A comp could only be
// given to an account that already existed (so every influencer met the plan
// page first) and never ended on its own. Now an admin promises the plan to
// an email, the organization made at sign-up gets it at once, and the comp
// carries its reason and end date.
let prisma: PrismaClient;
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

const signUp = async (email: string) => {
  // Sign-ups are limited per address; every run comes from its own.
  const api = await pwRequest.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: {
      'x-forwarded-for': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
  try {
    const res = await api.post('/auth/register', {
      data: {
        provider: 'LOCAL',
        email,
        password: 'Stack-comps-T-1',
        company: 'Stack creator',
        termsAccepted: true,
      },
    });
    // Read before the context goes: a disposed response has no body.
    return { status: res.status(), text: await res.text() };
  } finally {
    await api.dispose();
  }
};

const removeUser = async (email: string) => {
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) return;
  const orgs = await prisma.userOrganization.findMany({ where: { userId: user.id } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.organizationId) } } });
  await prisma.user.deleteMany({ where: { id: user.id } });
};

test('a plan promised to an email is on the organization the moment it signs up', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const email = `creator-${process.pid}-${Date.now()}@example.com`;
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await makeAdministrator(prisma, { api: staff.api, userId: staffUser.userId });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);

    // Typed with capitals: the sign-up stores the address in lower case.
    const promised = await staff.api.post('/admin/pending-grants', {
      data: { email: email.toUpperCase(), subscription: 'PRO', months: 3, reason: 'influencer' },
    });
    expect(promised.status(), await promised.text()).toBe(201);
    const grant = await promised.json();
    expect(grant).toMatchObject({ email, tier: 'PRO', months: 3, reason: 'influencer', consumedAt: null });

    const before = Date.now();
    const registered = await signUp(email);
    expect(registered.status, registered.text).toBeLessThan(300);

    const member = await prisma.userOrganization.findFirstOrThrow({
      where: { user: { email } },
      include: { organization: { include: { subscription: true } } },
    });
    const sub = member.organization.subscription!;
    expect(sub).toMatchObject({
      subscriptionTier: 'PRO',
      isLifetime: false,
      compReason: 'influencer',
      deletedAt: null,
    });
    const days = (sub.compEndsAt!.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(88);
    expect(days).toBeLessThan(93);

    const used = await prisma.pendingGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(used.consumedAt).not.toBeNull();
    expect(used.organizationId).toBe(member.organizationId);

    // The admin list shows the comp with its end date, and the grant as used.
    const list = await (await staff.api.get('/admin/comps')).json();
    expect(list.comps.find((c: any) => c.organizationId === member.organizationId)).toMatchObject({
      subscriptionTier: 'PRO',
      compReason: 'influencer',
    });
    expect(list.pending.find((p: any) => p.id === grant.id).consumedAt).not.toBeNull();

    // The address has an account now: the next promise is refused, and the
    // panel says to comp the organization instead.
    const again = await staff.api.post('/admin/pending-grants', {
      data: { email, subscription: 'PRO', months: 1, reason: 'influencer' },
    });
    expect(again.status()).toBe(409);
    expect(await again.text()).toMatch(/comp its organization/);
  } finally {
    await prisma.pendingGrant.deleteMany({ where: { email } });
    await removeUser(email);
    await staff.remove();
  }
});

test('a waiting grant can be deleted, and a deleted one gives nothing at sign-up', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const email = `changed-mind-${process.pid}-${Date.now()}@example.com`;
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await makeAdministrator(prisma, { api: staff.api, userId: staffUser.userId });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);

    const grant = await (
      await staff.api.post('/admin/pending-grants', { data: { email, subscription: 'PRO', months: 1, reason: 'tester' } })
    ).json();
    expect((await staff.api.delete(`/admin/pending-grants/${grant.id}`)).status()).toBe(200);
    expect((await staff.api.delete(`/admin/pending-grants/${grant.id}`)).status()).toBe(404);

    expect((await signUp(email)).status).toBeLessThan(300);
    const member = await prisma.userOrganization.findFirstOrThrow({
      where: { user: { email } },
      include: { organization: { include: { subscription: true } } },
    });
    expect(member.organization.subscription).toBeNull();
  } finally {
    await prisma.pendingGrant.deleteMany({ where: { email } });
    await removeUser(email);
    await staff.remove();
  }
});

test('bad promises are refused with 400 and nothing is stored', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await makeAdministrator(prisma, { api: staff.api, userId: staffUser.userId });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);
    const email = `bad-${process.pid}-${Date.now()}@example.com`;
    for (const data of [
      { email: 'not-an-email', subscription: 'PRO' },
      { email, subscription: 'FREE' },
      { email, subscription: 'PRO', months: 2 },
      { email, subscription: 'PRO', reason: 'friend' },
    ]) {
      const res = await staff.api.post('/admin/pending-grants', { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }
    expect(await prisma.pendingGrant.count({ where: { email } })).toBe(0);
  } finally {
    await staff.remove();
  }
});

test('a comp with a length ends on its date; a later lifetime grant carries no end date', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await makeAdministrator(prisma, { api: staff.api, userId: staffUser.userId });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);
    await prisma.subscription.deleteMany({ where: { organizationId: target.orgId } });

    const comp = await staff.api.post('/admin/comp-subscription', {
      data: { organizationId: target.orgId, subscription: 'PRO', months: 1, reason: 'tester' },
    });
    expect(comp.status(), await comp.text()).toBe(201);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: target.orgId } });
    expect(sub.compReason).toBe('tester');
    const days = (sub.compEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);

    // The Users list shows it, so the panel can say "comp until …".
    const targetUser = await prisma.user.findFirstOrThrow({
      where: { organizations: { some: { organizationId: target.orgId } } },
    });
    const users = await (await staff.api.get(`/admin/users?search=${encodeURIComponent(targetUser.email)}`)).json();
    expect(users.items[0].organizations[0].organization.subscription.compEndsAt).toBeTruthy();

    // Any other write of the plan clears the comp's terms: a plan given for
    // good must not be taken back on the old comp's end date.
    expect((await staff.api.post('/admin/revoke-subscription', { data: { organizationId: target.orgId } })).status()).toBe(201);
    const granted = await staff.api.post('/admin/grant-lifetime', { data: { email: targetUser.email, apply: true } });
    expect(granted.status(), await granted.text()).toBe(201);
    const lifetime = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: target.orgId } });
    expect(lifetime).toMatchObject({ isLifetime: true, compEndsAt: null, compReason: null });
  } finally {
    await staff.remove();
    await target.remove();
  }
});
