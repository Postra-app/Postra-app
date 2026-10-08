import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// E2E-07-33: a plan change trimmed channels and seats, but not Auto Post feeds
// or webhooks. Business -> Pro left all ten feeds running (Pro allows 3) and
// any switched-off feed could be switched on again; webhooks over the new
// limit (even FREE's 0) kept receiving deliveries.

const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('a downgrade keeps the oldest feeds and webhooks within the new plan, and the rest stay off', async () => {
  test.setTimeout(120_000);
  const staff = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  const target = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 10, channels: 0 });
  try {
    const staffUser = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: staff.orgId } });
    await prisma.user.update({ where: { id: staffUser.userId }, data: { isSuperAdmin: true } });
    await expect.poll(async () => (await staff.api.get('/admin/stats')).status(), { timeout: 60_000 }).toBe(200);

    const day = (n: number) => new Date(Date.now() - (10 - n) * 86_400_000);
    for (let n = 0; n < 5; n++) {
      await prisma.autoPost.create({
        data: {
          organizationId: target.orgId,
          title: `feed ${n}`,
          url: `https://example.com/feed-${n}.xml`,
          lastUrl: '',
          onSlot: false,
          syncLast: false,
          active: true,
          addPicture: false,
          generateContent: false,
          integrations: '[]',
          createdAt: day(n),
        },
      });
      await prisma.webhooks.create({
        data: { organizationId: target.orgId, name: `hook ${n}`, url: `https://example.com/hook-${n}`, createdAt: day(n) },
      });
    }
    const feeds = async () =>
      (await prisma.autoPost.findMany({ where: { organizationId: target.orgId }, orderBy: { createdAt: 'asc' } })).map(
        (f) => f.active
      );

    // Business -> Pro: 3 feeds.
    const toPro = await staff.api.post('/admin/comp-subscription', { data: { organizationId: target.orgId, subscription: 'PRO' } });
    expect(toPro.status(), await toPro.text()).toBe(201);
    expect(await feeds()).toEqual([true, true, true, false, false]);

    // A feed switched off by the downgrade cannot be switched on past the limit.
    const fourth = await prisma.autoPost.findFirstOrThrow({ where: { organizationId: target.orgId, title: 'feed 3' } });
    expect((await target.api.post(`/autopost/${fourth.id}/active`, { data: { active: true } })).status()).toBe(402);
    expect(await feeds()).toEqual([true, true, true, false, false]);
    // Room again after one is switched off.
    const first = await prisma.autoPost.findFirstOrThrow({ where: { organizationId: target.orgId, title: 'feed 0' } });
    expect((await target.api.post(`/autopost/${first.id}/active`, { data: { active: false } })).status()).toBe(201);
    expect((await target.api.post(`/autopost/${fourth.id}/active`, { data: { active: true } })).status()).toBe(201);

    // Pro -> Starter: no feeds, 2 webhooks; the newer three are paused.
    const toStarter = await staff.api.post('/admin/comp-subscription', { data: { organizationId: target.orgId, subscription: 'STANDARD' } });
    expect(toStarter.status(), await toStarter.text()).toBe(201);
    expect(await feeds()).toEqual([false, false, false, false, false]);
    const hooks = ((await (await target.api.get('/webhooks')).json()) as { name: string; paused: boolean }[]).map(
      (h) => `${h.name}:${h.paused}`
    );
    expect(hooks).toEqual(['hook 0:false', 'hook 1:false', 'hook 2:true', 'hook 3:true', 'hook 4:true']);
  } finally {
    await prisma.autoPost.deleteMany({ where: { organizationId: target.orgId } });
    await prisma.webhooks.deleteMany({ where: { organizationId: target.orgId } });
    await staff.remove();
    await target.remove();
  }
});

// Codex: the count and the switch-on were separate, so two feeds switched on
// at once both saw room for one.
test('two feeds switched on at once with room for one: only one runs', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const feed = (n: number, active: boolean) =>
      prisma.autoPost.create({
        data: {
          organizationId: org.orgId, title: `race ${n}`, url: `https://example.com/race-${n}.xml`, lastUrl: '',
          onSlot: false, syncLast: false, active, addPicture: false, generateContent: false, integrations: '[]',
        },
      });
    await feed(0, true);
    await feed(1, true);
    const [a, b] = [await feed(2, false), await feed(3, false)];
    const results = await Promise.all([a, b].map((f) => org.api.post(`/autopost/${f.id}/active`, { data: { active: true } })));
    expect(results.map((r) => r.status()).sort()).toEqual([201, 402]);
    expect(await prisma.autoPost.count({ where: { organizationId: org.orgId, active: true } })).toBe(3);
  } finally {
    await prisma.autoPost.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

// Codex: PUT /autopost/:id with active: true switched a feed on past the limit.
test('an edit that switches a feed on counts against the limit too', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const feed = (n: number, active: boolean) =>
      prisma.autoPost.create({
        data: {
          organizationId: org.orgId, title: `edit ${n}`, url: `https://example.com/edit-${n}.xml`, lastUrl: '',
          onSlot: false, syncLast: false, active, addPicture: false, generateContent: false, integrations: '[]',
        },
      });
    for (let n = 0; n < 3; n++) await feed(n, true);
    const off = await feed(3, false);
    const res = await org.api.put(`/autopost/${off.id}`, {
      data: {
        title: 'edit 3', url: 'https://example.com/edit-3.xml', onSlot: false, syncLast: false, active: true,
        addPicture: false, generateContent: false, integrations: [],
      },
    });
    expect(res.status(), await res.text()).toBe(402);
    expect(await prisma.autoPost.count({ where: { organizationId: org.orgId, active: true } })).toBe(3);
  } finally {
    await prisma.autoPost.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

