import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, signedIn, throwawayOrg, makeAdministrator } from '../helpers';

// What a plan pays for (pricing.ts allowedProviders). Organisation A is on
// Pro, B on Starter; billing is on in the stack like in production.

const connect = (platform: string) => `/integrations/social/${platform}`;

test('Starter cannot connect Pro or Business platforms', async () => {
  const starter = await signedIn('b');
  for (const platform of ['youtube', 'threads', 'linkedin-page', 'bluesky', 'mastodon', 'telegram', 'x', 'discord']) {
    expect((await starter.get(connect(platform))).status(), platform).toBe(402);
  }
  // The message names the platform as the picker does, not by its identifier
  // ("The youtube channel…").
  expect(await (await starter.get(connect('youtube'))).text()).toContain("The YouTube channel isn't included in your plan");
  expect(await (await starter.get(connect('linkedin-page'))).text()).toContain('The LinkedIn Page channel');
  await starter.dispose();
});

test('Starter can start connecting its own platforms', async () => {
  const starter = await signedIn('b');
  for (const platform of ['facebook', 'instagram', 'tiktok', 'linkedin']) {
    expect((await starter.get(connect(platform))).status(), platform).not.toBe(402);
  }
  await starter.dispose();
});

test('Pro gets YouTube, Threads, Bluesky, Mastodon and Telegram but not X or Discord', async () => {
  const pro = await signedIn('a');
  for (const platform of ['youtube', 'threads', 'bluesky', 'mastodon', 'telegram']) {
    expect((await pro.get(connect(platform))).status(), platform).not.toBe(402);
  }
  for (const platform of ['x', 'discord']) {
    expect((await pro.get(connect(platform))).status(), platform).toBe(402);
  }
  await pro.dispose();
});

test('an unknown platform is 400, and reconnecting a channel you lack is 404', async () => {
  const pro = await signedIn('a');
  expect((await pro.get(connect('not-a-platform'))).status()).toBe(400);
  expect((await pro.get(`${connect('youtube')}?refresh=not-my-channel`)).status()).toBe(404);
  await pro.dispose();
});

// How many channels a plan holds (subscription.totalChannels: 3/6/12), and
// the trial cap of 3 whatever the tier (pricing.ts TRIAL_CHANNEL_CAP). Each
// case gets its own organisation: filling A or B would break other specs.

test.describe('channel count', () => {
  const prisma = database();
  const orgs: { remove: () => Promise<void> }[] = [];
  const org = async (options: Parameters<typeof throwawayOrg>[1]) => {
    const created = await throwawayOrg(prisma, options);
    orgs.push(created);
    return created;
  };
  test.afterAll(async () => {
    for (const created of orgs) await created.remove();
    await prisma.$disconnect();
  });

  // One slot rule for every entry point (pricing.ts channelsInUse): a channel
  // waiting to be reconnected keeps its slot, a disabled one frees it.
  test('a channel waiting for reconnection keeps its slot; a disabled one frees it', async () => {
    const waiting = await org({ tier: 'STANDARD', totalChannels: 3, channels: 3, provider: 'linkedin' });
    await prisma.integration.update({ where: { id: waiting.channelIds[0] }, data: { refreshNeeded: true } });
    expect((await waiting.api.get(connect('facebook'))).status(), 'refreshNeeded still counts').toBe(402);

    const freed = await org({ tier: 'STANDARD', totalChannels: 3, channels: 3, provider: 'linkedin' });
    await prisma.integration.update({ where: { id: freed.channelIds[0] }, data: { disabled: true } });
    expect((await freed.api.get(connect('facebook'))).status(), 'disabled frees a slot').not.toBe(402);
    // And re-enabling it, with the slot now free, is allowed.
    expect((await freed.api.post('/integrations/enable', { data: { id: freed.channelIds[0] } })).status()).toBeLessThan(300);
  });

  // Two channels switched on at once both saw the one free slot.
  test('one free slot, two channels switched on at once: only one is', async () => {
    const full = await org({ tier: 'STANDARD', totalChannels: 3, channels: 4, provider: 'linkedin' });
    await prisma.integration.updateMany({
      where: { id: { in: full.channelIds.slice(2) } },
      data: { disabled: true },
    });
    const statuses = await Promise.all(
      full.channelIds.slice(2).map(async (id) =>
        (await full.api.post('/integrations/enable', { data: { id } })).status()
      )
    );
    expect(statuses.filter((s) => s < 300)).toHaveLength(1);
    expect(
      await prisma.integration.count({ where: { organizationId: full.orgId, disabled: false, deletedAt: null } })
    ).toBe(3);
  });

  test('Starter with 3 of 3 channels cannot start connecting a 4th', async () => {
    const { api } = await org({ tier: 'STANDARD', totalChannels: 3, channels: 3, provider: 'linkedin' });
    const res = await api.get(connect('linkedin'));
    expect(res.status()).toBe(402);
    expect((await res.json()).message).toContain('maximum number of channels');
  });

  test('Starter with 2 of 3 channels can', async () => {
    const { api } = await org({ tier: 'STANDARD', totalChannels: 3, channels: 2, provider: 'linkedin' });
    expect((await api.get(connect('linkedin'))).status()).toBe(200);
  });

  test('a Pro trial is capped at 3 channels, the same Pro paid is not', async () => {
    const trial = await org({ tier: 'PRO', totalChannels: 6, channels: 3, isTrailing: true });
    expect((await trial.api.get(connect('mastodon'))).status()).toBe(402);
    expect((await trial.api.get(connect('youtube'))).status()).toBe(402);

    const paid = await org({ tier: 'PRO', totalChannels: 6, channels: 3 });
    expect((await paid.api.get(connect('mastodon'))).status()).toBe(200);
  });

  test('a Business trial with 2 channels can still add a 3rd', async () => {
    const { api } = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 2, isTrailing: true });
    expect((await api.get(connect('mastodon'))).status()).toBe(200);
  });

  test('a full org can still reconnect a channel it has', async () => {
    // Reconnecting adds nothing, so the cap must not lock a full org out of
    // repairing a token. `refresh` carries the channel's internalId — what
    // launches.component.tsx and render.analytics.tsx send.
    const { api, channelIds } = await org({ tier: 'STANDARD', totalChannels: 3, channels: 3, provider: 'linkedin' });
    const res = await api.get(`${connect('linkedin')}?refresh=${channelIds[0]}-internal`);
    expect(res.status(), await res.text()).not.toBe(402);
    expect(res.status()).toBeLessThan(500);
  });
});

// LinkedIn Pages in early access (linkedin-pages.limits.ts): Business only,
// up to 5 Pages per workspace (100 across Postra), one post a day on each
// Page. Connections are refused on the dashboard, the invite callback and
// the public API alike; a Page already connected can always be reconnected.
test('LinkedIn Pages: Business only, 5 per workspace, a Page already there can be reconnected', async () => {
  const prisma = database();
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 8, channels: 0 });
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 15, channels: 0 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const publicApi = await request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: apiKey! },
  });
  try {
    expect((await pro.api.get(connect('linkedin-page'))).status()).toBe(402);

    const listed = (await (await org.api.get('/integrations')).json()).social.find(
      (p: any) => p.identifier === 'linkedin-page'
    );
    expect(listed).toMatchObject({ enabled: true });
    expect(listed.preview).toBeFalsy();
    const first = await org.api.get(connect('linkedin-page'));
    expect(first.status(), await first.text()).toBe(200);
    expect((await publicApi.get('social/linkedin-page')).status()).toBe(200);

    for (let i = 0; i < 5; i++) {
      await prisma.integration.create({
        data: {
          id: `stack-li-page-${org.orgId}-${i}`,
          internalId: `li-page-${org.orgId}-${i}`,
          organizationId: org.orgId,
          name: `Page ${i}`,
          providerIdentifier: 'linkedin-page',
          type: 'social',
          token: 'fake-token',
          profile: 'page',
        },
      });
    }
    const sixth = await org.api.get(connect('linkedin-page'));
    expect(sixth.status(), await sixth.text()).toBe(403);
    expect(await sixth.text()).toContain('up to 5 Pages per workspace');
    expect((await publicApi.get('social/linkedin-page')).status()).toBe(403);

    // The invite callback checks again, with a state minted before the fifth.
    const callback = await org.api.post('/integrations/social-connect/linkedin-page', {
      data: { state: new URL((await first.json()).url).searchParams.get('state'), code: 'x', timezone: '0' },
    });
    expect(callback.status(), await callback.text()).toBe(403);

    const reconnect = await org.api.get(`${connect('linkedin-page')}?refresh=li-page-${org.orgId}-0`);
    expect(reconnect.status(), await reconnect.text()).toBe(200);
    expect((await publicApi.get(`social/linkedin-page?refresh=li-page-${org.orgId}-0`)).status()).toBe(200);
  } finally {
    await publicApi.dispose();
    await prisma.integration.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
    await pro.remove();
    await prisma.$disconnect();
  }
});

test('LinkedIn Pages: one post a day on each Page, drafts and other Pages not counted', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 15, channels: 0 });
  const day = new Date(Date.now() + 3 * 86_400_000);
  day.setUTCHours(9, 0, 0, 0);
  const at = (hours: number) => new Date(day.getTime() + hours * 3_600_000).toISOString().slice(0, 19);
  const pages = [0, 1].map((i) => `stack-li-post-${org.orgId}-${i}`);
  const post = (page: string, type: string, date: string) =>
    org.api.post('/posts', {
      data: {
        type,
        shortLink: false,
        date,
        tags: [],
        posts: [{ integration: { id: page }, value: [{ content: `for ${page}`, image: [] }], settings: { __type: 'linkedin-page' } }],
      },
    });
  try {
    for (const [i, id] of pages.entries()) {
      await prisma.integration.create({
        data: {
          id,
          internalId: `li-post-${org.orgId}-${i}`,
          organizationId: org.orgId,
          name: `Page ${i}`,
          providerIdentifier: 'linkedin-page',
          type: 'social',
          token: 'fake-token',
          profile: 'page',
        },
      });
    }
    const first = await post(pages[0], 'schedule', at(0));
    expect(first.status(), await first.text()).toBe(201);

    const second = await post(pages[0], 'schedule', at(5));
    expect(second.status(), await second.text()).toBe(400);
    expect(await second.text()).toContain('one post a day per Page');

    // A draft on the same day, the other Page, and the next day are fine.
    expect((await post(pages[0], 'draft', at(6))).status()).toBe(201);
    expect((await post(pages[1], 'schedule', at(1))).status()).toBe(201);
    expect((await post(pages[0], 'schedule', at(24))).status()).toBe(201);

    // Editing the day's post does not count it against itself.
    const [{ postId }] = (await first.json()) as { postId: string }[];
    const saved = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    const edit = await org.api.post('/posts', {
      data: {
        type: 'schedule',
        shortLink: false,
        date: at(2),
        tags: [],
        posts: [{ integration: { id: pages[0] }, value: [{ id: postId, content: 'edited', image: [] }], settings: { __type: 'linkedin-page' } }],
        group: saved.group,
      },
    });
    expect(edit.status(), await edit.text()).toBe(201);

    // Dragging the next day's post onto a day the Page already has one for
    // is refused; onto a free day it moves.
    const nextDay = await prisma.post.findFirstOrThrow({
      where: { integrationId: pages[0], state: 'QUEUE', publishDate: { gte: new Date(day.getTime() + 20 * 3_600_000) } },
    });
    const moved = await org.api.put(`/posts/${nextDay.id}/date`, { data: { date: at(7), action: 'update' } });
    expect(moved.status(), await moved.text()).toBe(400);
    expect(await moved.text()).toContain('one post a day per Page');
    expect((await org.api.put(`/posts/${nextDay.id}/date`, { data: { date: at(48), action: 'update' } })).status()).toBe(200);

    // Two posts for one Page and day in a single request count together.
    const twice = await org.api.post('/posts', {
      data: {
        type: 'schedule',
        shortLink: false,
        date: at(96),
        tags: [],
        posts: [0, 1].map((n) => ({
          integration: { id: pages[1] },
          value: [{ content: `twice ${n}`, image: [] }],
          settings: { __type: 'linkedin-page' },
        })),
      },
    });
    expect(twice.status(), await twice.text()).toBe(400);

    // A repeating post would go out again on later days: a Page takes none.
    const repeating = await org.api.post('/posts', {
      data: {
        type: 'schedule',
        shortLink: false,
        date: at(120),
        inter: 1,
        tags: [],
        posts: [{ integration: { id: pages[1] }, value: [{ content: 'daily', image: [] }], settings: { __type: 'linkedin-page' } }],
      },
    });
    expect(repeating.status(), await repeating.text()).toBe(400);
    expect(await repeating.text()).toContain('Repeating posts are not available');
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await prisma.integration.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
    await prisma.$disconnect();
  }
});

// Google Business Profile left the preview on 2026-11-17 (Google approved
// the API): an offered platform from Pro, behind the plan like the others.
// Nothing is in the preview list now, so no one gets past a plan with it.
test('Google Business Profile is offered from Pro, and the other platforms keep their plans', async () => {
  const prisma = database();
  const customer = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 5, channels: 0 });
  const pro = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 8, channels: 0 });
  const admin = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 5, channels: 0 });
  // Before admin's first request: the auth middleware caches the user.
  const adminUser = (await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: admin.orgId } })).userId;
  await makeAdministrator(prisma, { api: admin.api, userId: adminUser });
  try {
    // Offered, named as Google names it, and not a preview any more.
    const listed = (await (await pro.api.get('/integrations')).json()).social.find(
      (p: any) => p.identifier === 'gmb'
    );
    expect(listed).toMatchObject({ enabled: true, name: 'Google Business Profile' });
    expect(listed.preview).toBeFalsy();
    expect(listed.adminOnly).toBeFalsy();
    expect((await pro.api.get(connect('gmb'))).status()).toBe(200);
    // Starter: the plan's 402, for a super admin too (no preview pass left).
    for (const who of [customer, admin]) {
      const res = await who.api.get(connect('gmb'));
      expect(res.status(), await res.text()).toBe(402);
    }

    // WordPress left the preview on 2026-11-01: Business only, so Starter
    // gets the plan's 402, not "Coming soon".
    const wordpress = await customer.api.get(connect('wordpress'));
    expect(wordpress.status(), await wordpress.text()).toBe(402);

    // Pinterest left the preview on 2026-10-27 (Standard access approved):
    // a customer on Starter connects it like the other Starter platforms.
    const pinterest = (await (await customer.api.get('/integrations')).json()).social.find(
      (p: any) => p.identifier === 'pinterest'
    );
    expect(pinterest).toMatchObject({ enabled: true });
    expect(pinterest.adminOnly).toBeFalsy();
    expect((await customer.api.get(connect('pinterest'))).status()).toBe(200);

    // Instagram without a Facebook Page passed Meta's App Review (2026-10-26):
    // a customer on Starter sees it and connects it like Instagram.
    const catalogue = await (await customer.api.get('/integrations')).json();
    const standalone = catalogue.social.find(
      (p: any) => p.identifier === 'instagram-standalone'
    );
    expect(standalone).toMatchObject({
      enabled: true,
      name: 'Instagram\n(no Facebook Page)',
    });
    expect(standalone.adminOnly).toBeFalsy();
    expect(
      catalogue.social.find((p: any) => p.identifier === 'instagram')
    ).toMatchObject({ enabled: true, name: 'Instagram\n(with Facebook Page)' });
    expect((await customer.api.get(connect('instagram-standalone'))).status()).toBe(200);

    // LinkedIn Pages are offered on Business only: Pro is sent to upgrade,
    // and a super admin on Starter follows the plan like anyone.
    const proAnswer = await pro.api.get(connect('linkedin-page'));
    expect(proAnswer.status(), await proAnswer.text()).toBe(402);
    expect(await proAnswer.text()).toContain("isn't included in your plan");
    expect((await admin.api.get(connect('linkedin-page'))).status()).toBe(402);
  } finally {
    await customer.remove();
    await pro.remove();
    await admin.remove();
    await prisma.$disconnect();
  }
});

// Instagram App Review: Meta's reviewer signs in as review@, which must not be
// a super admin. Its organisation, named in PREVIEW_ORGANIZATIONS, gets the
// preview platforms the way a super admin does; others do not. The list is
// empty today, so the reviewer's organisation follows its plan like anyone.
test('a preview organisation is marked, and with no preview platform it follows its plan', async () => {
  const prisma = database();
  const reviewer = await throwawayOrg(prisma, {
    tier: 'STANDARD',
    totalChannels: 5,
    channels: 0,
    id: 'stack-preview-org',
  });
  const customer = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 5, channels: 0 });
  try {
    const self = await (await reviewer.api.get('/user/self')).json();
    expect(self).toMatchObject({ previewChannels: true, isSuperAdmin: false });
    expect((await (await customer.api.get('/user/self')).json()).previewChannels).toBe(false);

    expect((await reviewer.api.get(connect('pinterest'))).status()).toBe(200);
    for (const who of [reviewer, customer]) {
      expect((await who.api.get(connect('gmb'))).status()).toBe(402);
      expect((await who.api.get(connect('linkedin-page'))).status()).toBe(402);
    }
  } finally {
    await reviewer.remove();
    await customer.remove();
    await prisma.$disconnect();
  }
});
