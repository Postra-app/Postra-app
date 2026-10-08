import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

const prisma = database();
test.afterAll(() => prisma.$disconnect());

// E2E-02-17: deleting the account took the redeemed lifetime code with it
// (UsedCodes cascaded from the organisation), so the same code could be
// redeemed again by a new account. The record outlives the organisation; it
// holds no personal data once the organisation is gone.
test('E2E-02-17: a redeemed lifetime code stays used after the account is deleted', async () => {
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const code = `stack-lifetime-${Date.now()}`;
  try {
    await prisma.usedCodes.create({ data: { code, orgId: org.orgId } });

    expect((await org.api.post('/user/delete', { data: {} })).status()).toBeLessThan(300);
    expect(await prisma.organization.count({ where: { id: org.orgId } })).toBe(0);

    const used = await prisma.usedCodes.findUnique({ where: { code } });
    expect(used).not.toBeNull();
    expect(used?.orgId).toBeNull();
  } finally {
    await prisma.usedCodes.deleteMany({ where: { code } });
    await org.remove();
  }
});
