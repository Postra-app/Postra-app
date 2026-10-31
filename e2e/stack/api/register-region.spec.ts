import { expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database } from '../helpers';

// A sign-up without ?region marked the organisation PL, while Postra launches
// in the UK. The region is now UK unless the sign-up names another.
for (const [sent, stored] of [[undefined, 'UK'], ['PL', 'PL']] as const) {
  test(`a sign-up with region ${sent ?? 'not given'} is a ${stored} organisation`, async () => {
    const prisma = database();
    // Lower case: the sign-up normalises the address.
    const email = `region-${(sent ?? 'none').toLowerCase()}-${process.pid}-${Date.now()}@example.com`;
    // Sign-ups are limited per address; every run comes from its own.
    const api = await pwRequest.newContext({
      baseURL: BACKEND_URL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
    });
    try {
      const res = await api.post('/auth/register', {
        data: {
          provider: 'LOCAL',
          email,
          password: 'Stack-region-T-1',
          company: 'Stack region',
          termsAccepted: true,
          ...(sent ? { region: sent } : {}),
        },
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
      const member = await prisma.userOrganization.findFirstOrThrow({
        where: { user: { email } },
        include: { organization: true },
      });
      expect(member.organization.region).toBe(stored);
    } finally {
      await api.dispose();
      const user = await prisma.user.findFirst({ where: { email } });
      if (user) {
        const orgs = await prisma.userOrganization.findMany({ where: { userId: user.id } });
        await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.organizationId) } } });
        await prisma.user.deleteMany({ where: { id: user.id } });
      }
      await prisma.$disconnect();
    }
  });
}
