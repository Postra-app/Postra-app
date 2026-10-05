import { expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, addMember, anonymous, database, throwawayOrg } from '../helpers';

const prisma = database();
test.afterAll(() => prisma.$disconnect());

// AUTH-7: the owner removing themselves left the team with nobody who can
// manage members or billing.
test('the only owner cannot remove themselves from the team', async () => {
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const member = await addMember(prisma, org.orgId, 'USER');
  try {
    const owner = await prisma.userOrganization.findFirstOrThrow({
      where: { organizationId: org.orgId, role: 'SUPERADMIN' },
    });
    const res = await org.api.delete(`/settings/team/${owner.userId}`);
    expect(res.status()).toBe(400);
    expect(await prisma.userOrganization.count({ where: { organizationId: org.orgId, role: 'SUPERADMIN' } })).toBe(1);
    // Removing an ordinary member still works.
    expect((await org.api.delete(`/settings/team/${member.userId}`)).status()).toBeLessThan(300);
  } finally {
    await member.remove();
    await org.remove();
  }
});

// AUTH-8: after deleting the account, another device signed in as the same
// person kept reading the shared organisation while the auth context was cached.
test('a deleted account is signed out on every device at once', async () => {
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const member = await addMember(prisma, org.orgId, 'USER');
  const { email } = await prisma.user.findUniqueOrThrow({ where: { id: member.userId } });
  const phone = await pwRequest.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: { 'x-forwarded-for': `198.20.${Math.floor(Math.random() * 250)}.7` },
  });
  try {
    expect((await phone.post('/auth/login', { data: { email, password: 'Stack-tests-T-1', provider: 'LOCAL' } })).status()).toBe(200);
    expect((await phone.get('/integrations/list')).status()).toBe(200); // warms the cache

    expect((await member.api.post('/user/delete', { data: {} })).status()).toBeLessThan(300);
    expect((await phone.get('/integrations/list')).status()).toBe(401);
  } finally {
    await phone.dispose();
    await member.remove();
    await org.remove();
  }
});

// AUTH-9: any providerToken switched the password policy off for a LOCAL
// sign-up, which then stored the password as sent.
test('a LOCAL sign-up with a providerToken still meets the password policy', async () => {
  const api = await anonymous();
  const res = await api.post('/auth/register', {
    data: {
      provider: 'LOCAL',
      providerToken: 'anything',
      email: `weak-${Date.now()}@example.com`,
      password: 'Ab1!xyz',
      company: 'Stack weak password',
      termsAccepted: true,
    },
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain('password');
  await api.dispose();
});

// AUTH-10: two signatures made the default at once each switched the other
// off, and the organisation was left with no default at all.
test('two signatures made the default at once leave exactly one default', async () => {
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  try {
    for (let round = 0; round < 5; round++) {
      const ids: string[] = [];
      for (const n of [1, 2]) {
        const res = await org.api.post('/signatures', { data: { content: `sig ${round}-${n}`, autoAdd: false } });
        ids.push((await res.json()).id);
      }
      await Promise.all(ids.map((id) => org.api.put(`/signatures/${id}`, { data: { content: 'default', autoAdd: true } })));
      const defaults = await prisma.signatures.count({
        where: { organizationId: org.orgId, autoAdd: true, deletedAt: null },
      });
      expect(defaults, `round ${round}`).toBe(1);
    }
  } finally {
    await org.remove();
  }
});
