import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The margin guard (Plan "💷 Analiza" pkt 9e): what AI cost each paying
// organisation in the last 30 days against its plan price. Admins only.

const prisma = database();
test.afterAll(() => prisma.$disconnect());

test('the AI cost report shows an organisation past 70% of its plan price, for admins only', async () => {
  const admin = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const heavy = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    expect((await heavy.api.get('/admin/ai-costs')).status()).toBe(403);

    const adminUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: admin.orgId } });
    await prisma.user.update({ where: { id: adminUser.userId }, data: { isSuperAdmin: true } });
    // 60 clips at $0.325 = $19.50 — over 70% of Starter's £19.
    await prisma.aiUsage.create({
      data: { organizationId: heavy.orgId, engine: 'video', model: 'veo3_fast', unit: 'videos', inputAmount: 60 },
    });

    await expect.poll(async () => (await admin.api.get('/admin/ai-costs')).status(), { timeout: 60_000 }).toBe(200);
    const report = await (await admin.api.get('/admin/ai-costs')).json();
    const row = report.organizations.find((r: any) => r.organizationId === heavy.orgId);
    expect(row).toMatchObject({ tier: 'STANDARD', planGbp: 19, alert: true });
    expect(row.costUsd).toBeCloseTo(19.5, 2);
    expect(report.threshold).toBe(0.7);
  } finally {
    await prisma.aiUsage.deleteMany({ where: { organizationId: heavy.orgId } });
    await heavy.remove();
    await admin.remove();
  }
});
