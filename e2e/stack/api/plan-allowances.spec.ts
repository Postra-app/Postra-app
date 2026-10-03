import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The allowances the paywall lists per plan (plan.features.ts), checked where
// the backend enforces them: AI images (subscription.service checkCredits and
// the media route), outgoing webhooks and Auto Post feeds (permissions.service).
// A trial runs on Starter's AI pool whatever the plan (trialAiAllowance).

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

const useImages = (organizationId: string, count: number) =>
  prisma.credits.create({ data: { organizationId, credits: count, type: 'ai_images' } });

const imagesLeft = async (api: Awaited<ReturnType<typeof org>>['api']) => {
  const res = await api.get('/copilot/credits?type=ai_images');
  expect(res.status()).toBe(200);
  return (await res.json()).credits as number;
};

test.describe('AI images a month', () => {
  test('Starter has 30; at 30 used the next image is refused before any AI call', async () => {
    const { api, orgId } = await org({ tier: 'STANDARD', totalChannels: 3, channels: 0 });
    expect(await imagesLeft(api)).toBe(30);

    await useImages(orgId, 30);
    expect(await imagesLeft(api)).toBe(0);
    const res = await api.post('/media/generate-image', { data: { prompt: 'a cup of coffee' } });
    expect(res.status()).toBe(402);
    expect((await res.json()).message).toContain('No image generation credits');
  });

  test('Pro has 150 once paid, but a Pro trial runs on Starter\'s 30', async () => {
    const paid = await org({ tier: 'PRO', totalChannels: 6, channels: 0 });
    await useImages(paid.orgId, 30);
    expect(await imagesLeft(paid.api)).toBe(120);

    const trial = await org({ tier: 'PRO', totalChannels: 6, channels: 0, isTrailing: true });
    expect(await imagesLeft(trial.api)).toBe(30);
  });

  test('Business has 600 once paid', async () => {
    const { api } = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 0 });
    expect(await imagesLeft(api)).toBe(600);
  });
});

test('Starter holds 2 outgoing webhooks and refuses a third', async () => {
  const { api, channelIds } = await org({ tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'linkedin' });
  const webhook = (n: number) => ({
    data: { name: `stack-cap-${n}`, url: `https://example.com/hooks/${n}`, integrations: [{ id: channelIds[0] }] },
  });
  expect((await api.post('/webhooks', webhook(1))).status()).toBe(201);
  expect((await api.post('/webhooks', webhook(2))).status()).toBe(201);
  const third = await api.post('/webhooks', webhook(3));
  expect(third.status()).toBe(402);
  expect((await third.json()).message).toContain('maximum number of webhooks');
});

test.describe('Auto Post feeds', () => {
  const feed = (n: number) => ({
    id: '',
    title: `stack feed ${n}`,
    onSlot: true,
    syncLast: false,
    url: `https://example.com/feed-${n}.xml`,
    active: false,
    addPicture: false,
    generateContent: true,
    integrations: [],
  });
  const seedFeeds = (organizationId: string, count: number) =>
    prisma.autoPost.createMany({
      data: Array.from({ length: count }, (_, n) => ({
        organizationId,
        title: `seeded ${n}`,
        onSlot: true,
        syncLast: false,
        url: `https://example.com/seeded-${n}.xml`,
        lastUrl: '',
        active: false,
        addPicture: false,
        generateContent: true,
        integrations: '[]',
      })),
    });

  test('Starter has none, and the refusal names the plans that do', async () => {
    const { api } = await org({ tier: 'STANDARD', totalChannels: 3, channels: 0 });
    const res = await api.post('/autopost', { data: feed(1) });
    expect(res.status()).toBe(402);
    expect((await res.json()).message).toContain('Pro (3 RSS feeds)');
  });

  test('Pro with 3 feeds refuses a 4th; Business with 3 does not', async () => {
    const pro = await org({ tier: 'PRO', totalChannels: 6, channels: 0 });
    await seedFeeds(pro.orgId, 3);
    expect((await pro.api.post('/autopost', { data: feed(4) })).status()).toBe(402);

    const business = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 0 });
    await seedFeeds(business.orgId, 3);
    expect((await business.api.post('/autopost', { data: feed(4) })).status()).not.toBe(402);
  });
});
