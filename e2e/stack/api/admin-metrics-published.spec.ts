import { expect, test } from '@playwright/test';
import { database, throwawayOrg, makeAdministrator } from '../helpers';

// Admin → Dashboards "Publish (24h)" counted Temporal's workflow counter,
// which every new process starts at its first publish, so after a restart
// it could show fewer publishes than Stats. The card now counts Post rows,
// with or without Grafana configured (the stack has none).

const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('the admin publish count comes from the posts, published and failed', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await makeAdministrator(prisma, { api: staff.api, userId: staffUser.userId });
    await expect.poll(async () => (await staff.api.get('/admin/metrics')).status(), { timeout: 60_000 }).toBe(200);

    const read = async () => {
      const res = await staff.api.get('/admin/metrics');
      expect(res.status()).toBe(200);
      return (await res.json()).publish24h as { completed: number; failed: number };
    };
    const before = await read();
    expect(before).toEqual({ completed: expect.any(Number), failed: expect.any(Number) });

    const base = {
      organizationId: target.orgId,
      integrationId: target.channelIds[0],
      content: '[stack] admin metrics',
    };
    const out = await prisma.post.create({
      data: { ...base, group: `metrics-${Date.now()}-a`, state: 'PUBLISHED', publishDate: new Date(Date.now() - 60_000) },
    });
    await prisma.post.create({
      data: { ...base, group: `metrics-${Date.now()}-b`, state: 'ERROR', publishDate: new Date(Date.now() - 60_000) },
    });

    const after = await read();
    // Other specs publish in parallel, so at least ours.
    expect(after.completed - before.completed).toBeGreaterThanOrEqual(1);
    expect(after.failed - before.failed).toBeGreaterThanOrEqual(1);
    expect(out.id).toBeTruthy();
  } finally {
    await target.remove();
    await staff.remove();
  }
});
