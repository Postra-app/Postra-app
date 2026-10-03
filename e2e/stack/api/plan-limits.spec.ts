import { expect, test } from '@playwright/test';
import { database, signedIn, throwawayOrg } from '../helpers';

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
