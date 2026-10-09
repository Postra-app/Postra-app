import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Support: a customer whose AI images or videos were used up by a failed or
// unfair run gets the month's allowance back from /admin (idea from upstream
// 4c5d42a92, which put it on the public API). Only this billing period's
// usage of that kind goes; older months and the other kind stay.

const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('a super admin resets one kind of AI credits for this billing period', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    // A plain member of an organisation is refused.
    const refused = await target.api.post('/admin/reset-credits', {
      data: { organizationId: target.orgId, type: 'ai_images' },
    });
    expect(refused.status()).toBe(403);

    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await prisma.user.update({ where: { id: staffUser.userId }, data: { isSuperAdmin: true } });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { organizationId: target.orgId } });
    // This period starts on the subscription's day of the month.
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { createdAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    const now = new Date();
    const lastPeriod = new Date(Date.now() - 35 * 86_400_000);
    await prisma.credits.createMany({
      data: [
        { organizationId: target.orgId, credits: 1, type: 'ai_images', createdAt: now },
        { organizationId: target.orgId, credits: 1, type: 'ai_images', createdAt: now },
        { organizationId: target.orgId, credits: 1, type: 'ai_images', createdAt: lastPeriod },
        { organizationId: target.orgId, credits: 1, type: 'ai_videos', createdAt: now },
      ],
    });
    const left = async () =>
      (await prisma.credits.findMany({ where: { organizationId: target.orgId }, orderBy: { createdAt: 'asc' } })).map(
        (c) => `${c.type}${c.createdAt < new Date(Date.now() - 30 * 86_400_000) ? ' old' : ''}`
      );

    const res = await staff.api.post('/admin/reset-credits', {
      data: { organizationId: target.orgId, type: 'ai_images' },
    });
    expect(res.status(), await res.text()).toBe(201);
    expect(await res.json()).toEqual({ organizationId: target.orgId, type: 'ai_images', deleted: 2 });
    expect((await left()).sort()).toEqual(['ai_images old', 'ai_videos']);

    for (const type of ['ai_agent', 'anything', undefined]) {
      expect((await staff.api.post('/admin/reset-credits', { data: { organizationId: target.orgId, type } })).status(), String(type)).toBe(400);
    }
    expect(
      (await staff.api.post('/admin/reset-credits', { data: { organizationId: '00000000-0000-4000-8000-000000000000', type: 'ai_videos' } })).status()
    ).toBe(400);
  } finally {
    await prisma.credits.deleteMany({ where: { organizationId: target.orgId } });
    await target.remove();
    await staff.remove();
  }
});

test('admin routes that move money are rate limited', async () => {
  // A stolen or scripted super-admin session could fire refunds and
  // cancellations without pause; everything else of /admin is read-only or
  // reversible.
  const someone = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    for (const route of ['/admin/refund-charges', '/admin/cancel-subscription']) {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        statuses.push((await someone.api.post(route, { data: {} })).status());
      }
      expect(statuses.slice(0, 20).every((s) => s === 403), `${route}: ${statuses}`).toBe(true);
      expect(statuses[20], route).toBe(429);
    }
  } finally {
    await someone.remove();
  }
});
