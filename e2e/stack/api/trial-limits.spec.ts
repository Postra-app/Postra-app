import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// K. 2026-10-16: a 7-day trial on any plan posts at most 30 a month, is one
// person, one webhook and one Auto Post feed (pricing.ts TRIAL_LIMITS). Before,
// a Business trial had unlimited posts, 5 seats, 10 000 webhooks and 10 feeds
// before the first charge.

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

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
const post = (channel: string, type: 'schedule' | 'draft', content: string) => ({
  type,
  shortLink: false,
  date: inDays(2).toISOString(),
  tags: [],
  posts: [{ integration: { id: channel }, value: [{ content, image: [] }], settings: { __type: 'bluesky' } }],
});
const queue = (organizationId: string, integrationId: string, count: number) =>
  prisma.post.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      organizationId,
      integrationId,
      content: `[stack] trial filler ${i}`,
      group: `stack-trial-${organizationId}-${i}`,
      state: 'QUEUE' as const,
      publishDate: inDays(1),
    })),
  });

test('a Business trial at 30 posts cannot schedule a 31st, in the app or the public API; a draft still saves', async () => {
  const trial = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 1, isTrailing: true });
  const [channel] = trial.channelIds;
  await queue(trial.orgId, channel, 30);

  const res = await trial.api.post('/posts', { data: post(channel, 'schedule', '[stack] 31st') });
  expect(res.status(), await res.text()).toBe(402);
  expect((await res.json()).message).toContain('maximum number of posts');

  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: trial.orgId } });
  const publicApi = await request.newContext({ baseURL: `${BACKEND_URL}/public/v1/`, extraHTTPHeaders: { authorization: apiKey! } });
  expect((await publicApi.post('posts', { data: post(channel, 'schedule', '[stack] 31st') })).status()).toBe(402);
  await publicApi.dispose();

  const draft = await trial.api.post('/posts', { data: post(channel, 'draft', '[stack] trial draft') });
  expect(draft.status(), await draft.text()).toBe(201);
});

test('the same Business plan, paid, is not held to 30 posts', async () => {
  const paid = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 1 });
  const [channel] = paid.channelIds;
  await queue(paid.orgId, channel, 30);
  // Past the allowance check, stopped by validation (empty content).
  const res = await paid.api.post('/posts', { data: post(channel, 'schedule', '') });
  expect(res.status(), await res.text()).toBe(400);
});

test('a Business trial holds one webhook', async () => {
  const trial = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 1, provider: 'linkedin', isTrailing: true });
  const webhook = (n: number) => ({
    data: { name: `stack-trial-${n}`, url: `https://example.com/hooks/${n}`, integrations: [{ id: trial.channelIds[0] }] },
  });
  expect((await trial.api.post('/webhooks', webhook(1))).status()).toBe(201);
  const second = await trial.api.post('/webhooks', webhook(2));
  expect(second.status()).toBe(402);
  expect((await second.json()).message).toContain('maximum number of webhooks');
});

test('a Business trial holds one Auto Post feed', async () => {
  const trial = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 0, isTrailing: true });
  const feed = (n: number) => ({
    id: '',
    title: `stack trial feed ${n}`,
    onSlot: true,
    syncLast: false,
    url: `https://example.com/trial-feed-${n}.xml`,
    active: false,
    addPicture: false,
    generateContent: true,
    integrations: [],
  });
  expect((await trial.api.post('/autopost', { data: feed(1) })).status()).toBe(201);
  expect((await trial.api.post('/autopost', { data: feed(2) })).status()).toBe(402);
  expect(await prisma.autoPost.count({ where: { organizationId: trial.orgId, deletedAt: null } })).toBe(1);
});

test('a Business trial cannot invite a team member; the paid plan can', async () => {
  const trial = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 0, isTrailing: true });
  const invite = { data: { email: `stack-trial-invite-${Date.now()}@example.com`, role: 'USER', sendEmail: false } };
  expect((await trial.api.post('/settings/team', invite)).status()).toBe(402);

  const paid = await org({ tier: 'ULTIMATE', totalChannels: 12, channels: 0 });
  expect((await paid.api.post('/settings/team', invite)).status()).toBeLessThan(300);
});
