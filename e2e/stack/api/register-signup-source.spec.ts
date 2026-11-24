import { expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database } from '../helpers';

// A sign-up that followed a campaign link keeps the campaign with the
// organisation it creates: three short labels, nothing else. A value that is
// not a short label is dropped, and the sign-up still goes through.
const cases = [
  {
    name: 'a campaign link',
    sent: { signupSource: 'Facebook', signupMedium: 'paid', signupCampaign: 'launch-week' },
    stored: { signupSource: 'facebook', signupMedium: 'paid', signupCampaign: 'launch-week' },
  },
  {
    name: 'no campaign',
    sent: {},
    stored: { signupSource: null, signupMedium: null, signupCampaign: null },
  },
  {
    name: 'a value that is not a label',
    sent: { signupSource: 'https://example.com/?fbclid=abc', signupMedium: 'x'.repeat(65), signupCampaign: 'spring_sale.1' },
    stored: { signupSource: null, signupMedium: null, signupCampaign: 'spring_sale.1' },
  },
] as const;

for (const [index, { name, sent, stored }] of cases.entries()) {
  test(`a sign-up with ${name} stores ${JSON.stringify(stored)}`, async () => {
    const prisma = database();
    // Lower case: the sign-up normalises the address.
    const email = `source-${index}-${process.pid}-${Date.now()}@example.com`;
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
          password: 'Stack-source-T-1',
          company: 'Stack source',
          termsAccepted: true,
          ...sent,
        },
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
      const member = await prisma.userOrganization.findFirstOrThrow({
        where: { user: { email } },
        include: { organization: true },
      });
      expect({
        signupSource: member.organization.signupSource,
        signupMedium: member.organization.signupMedium,
        signupCampaign: member.organization.signupCampaign,
      }).toEqual(stored);
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
