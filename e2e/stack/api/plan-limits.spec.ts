import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, signedIn, throwawayOrg } from '../helpers';

// What a plan pays for (pricing.ts allowedProviders). Organisation A is on
// Pro, B on Starter; billing is on in the stack like in production.

const connect = (platform: string) => `/integrations/social/${platform}`;

test('Starter cannot connect Pro or Business platforms', async () => {
  const starter = await signedIn('b');
  for (const platform of ['youtube', 'threads', 'linkedin-page', 'bluesky', 'mastodon', 'telegram', 'x', 'discord']) {
    expect((await starter.get(connect(platform))).status(), platform).toBe(402);
  }
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

// A platform still "Coming soon" in the app (LinkedIn Page) was
// refused only by the UI. On Pro the API handed out its auth URL, through the
// dashboard route and the public API, and the callback connected it. A page
// connected before stays reconnectable.
test('a "Coming soon" platform takes no new channels; one already there can be reconnected', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const publicApi = await request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: apiKey! },
  });
  try {
    const dashboard = await org.api.get(connect('linkedin-page'));
    expect(dashboard.status(), await dashboard.text()).toBe(403);
    expect(await dashboard.text()).toContain("isn't available yet");
    expect((await publicApi.get('social/linkedin-page')).status()).toBe(403);
    expect((await publicApi.get('social/linkedin-page?refresh=not-my-page')).status()).toBe(404);

    // A state minted for an offered platform cannot finish one that is not.
    const minted = await org.api.get(connect('mastodon'));
    expect(minted.status()).toBe(200);
    const state = new URL((await minted.json()).url).searchParams.get('state');
    const callback = await org.api.post('/integrations/social-connect/linkedin-page', {
      data: { state, code: 'x', timezone: '0' },
    });
    expect(callback.status(), await callback.text()).toBe(403);

    await prisma.integration.create({
      data: {
        id: `stack-li-page-${org.orgId}`,
        internalId: `li-page-${org.orgId}`,
        organizationId: org.orgId,
        name: 'Page connected earlier',
        providerIdentifier: 'linkedin-page',
        type: 'social',
        token: 'fake-token',
        profile: 'page',
      },
    });
    const reconnect = await org.api.get(`${connect('linkedin-page')}?refresh=li-page-${org.orgId}`);
    expect(reconnect.status(), await reconnect.text()).toBe(200);
    expect((await publicApi.get(`social/linkedin-page?refresh=li-page-${org.orgId}`)).status()).toBe(200);
  } finally {
    await publicApi.dispose();
    await prisma.integration.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
    await prisma.$disconnect();
  }
});

// Preview platforms (previewProviders in integration.manager.ts): "Coming
// soon" for customers, but a super admin can connect one into their own
// organisation, to test it on production and to record the platform's
// review video. The pass is bound to the platform it was minted for.
test('a preview platform is "Coming soon" for customers and open to a super admin', async () => {
  const prisma = database();
  const customer = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 5, channels: 0 });
  const admin = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 5, channels: 0 });
  // Before admin's first request: the auth middleware caches the user.
  const adminUser = (await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: admin.orgId } })).userId;
  await prisma.user.update({ where: { id: adminUser }, data: { isSuperAdmin: true } });
  try {
    // Refused: 402 because Starter lacks it, before "Coming soon" (403).
    const wordpress = await customer.api.get(connect('wordpress'));
    expect([402, 403], await wordpress.text()).toContain(wordpress.status());

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

    // Starter lacks WordPress: the preview pass skips the plan gate too.
    const preview = await admin.api.get(connect('wordpress'));
    expect(preview.status(), await preview.text()).toBe(200);
    // Not through an invite link, which connects someone else's account.
    expect((await admin.api.get(`${connect('wordpress')}?invite=true`)).status()).toBe(402);
    // Not for a platform outside the preview list.
    expect((await admin.api.get(connect('linkedin-page'))).status()).toBe(402);

    // A link minted for another platform (Pinterest, no preview pass) does
    // not open WordPress at the callback.
    const minted = await admin.api.get(connect('pinterest'));
    const state = new URL((await minted.json()).url).searchParams.get('state');
    const other = await admin.api.post('/integrations/social-connect/wordpress', {
      data: { state, code: 'x', timezone: '0' },
    });
    expect(other.status(), await other.text()).toBe(403);

    // The pass for WordPress gets past "Coming soon" and the plan; the made-up
    // blog then fails the sign-in, which is the next check, not a 402/403.
    const wp = await admin.api.get(connect('wordpress'));
    const wpState = (await wp.json()).url;
    const code = Buffer.from(
      JSON.stringify({ domain: 'https://example.invalid', username: 'u', password: 'p' })
    ).toString('base64');
    const finish = await admin.api.post('/integrations/social-connect/wordpress', {
      data: { state: wpState, code, timezone: '0' },
    });
    expect([402, 403], await finish.text()).not.toContain(finish.status());
  } finally {
    await customer.remove();
    await admin.remove();
    await prisma.$disconnect();
  }
});

// Instagram App Review: Meta's reviewer signs in as review@, which must not be
// a super admin. Its organisation, named in PREVIEW_ORGANIZATIONS, gets the
// preview platforms the way a super admin does; others do not.
test('a preview organisation connects a preview platform without being a super admin', async () => {
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

    for (const platform of ['pinterest', 'wordpress']) {
      const res = await reviewer.api.get(connect(platform));
      expect(res.status(), `${platform}: ${await res.text()}`).toBe(200);
    }
    const refused = await customer.api.get(connect('wordpress'));
    expect([402, 403], await refused.text()).toContain(refused.status());

    // Still only the preview list, and not through an invite link.
    expect((await reviewer.api.get(connect('linkedin-page'))).status()).toBe(402);
    expect(
      (await reviewer.api.get(`${connect('wordpress')}?invite=true`)).status()
    ).not.toBe(200);
  } finally {
    await reviewer.remove();
    await customer.remove();
    await prisma.$disconnect();
  }
});
