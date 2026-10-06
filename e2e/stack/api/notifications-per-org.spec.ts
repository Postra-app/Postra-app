import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// E2E-02-38: the bell's "read" marker sat on the user, so opening the bell in
// one organisation marked every other organisation's notifications read.
test('opening the bell in one organisation leaves the other one unread', async () => {
  const prisma = database();
  const a = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const b = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    const { userId } = await prisma.userOrganization.findFirstOrThrow({
      where: { organizationId: a.orgId },
    });
    await prisma.userOrganization.create({
      data: { userId, organizationId: b.orgId, role: 'ADMIN' },
    });
    const as = (orgId: string) => ({ headers: { showorg: orgId } });
    const unread = async (orgId: string) =>
      (await (await a.api.get('/notifications', as(orgId))).json()).total;

    await prisma.notifications.createMany({
      data: [
        { organizationId: a.orgId, content: 'Published in A' },
        { organizationId: b.orgId, content: 'Published in B' },
      ],
    });
    expect(await unread(a.orgId)).toBe(1);
    expect(await unread(b.orgId)).toBe(1);

    expect((await a.api.get('/notifications/list', as(a.orgId))).status()).toBe(200);
    expect(await unread(a.orgId)).toBe(0);
    expect(await unread(b.orgId)).toBe(1);
  } finally {
    await prisma.userOrganization.deleteMany({ where: { organizationId: b.orgId } });
    await b.remove();
    await a.remove();
    await prisma.$disconnect();
  }
});
