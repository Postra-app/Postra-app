import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// Starter allows 400 posts a month (pricing.ts posts_per_month). Counted:
// QUEUE and PUBLISHED posts dated from the start of the current cycle
// (postsCycleStart, shared with the AI agent's scheduling tool since
// e13984ed). Not counted: drafts, deleted posts, earlier cycles.

const prisma = database();
test.afterAll(() => prisma.$disconnect());

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

// What the composer sends; `content` empty fails validation with a 400 —
// which can only happen once the allowance check has let the request through.
const body = (channel: string, type: 'schedule' | 'draft', content: string) => ({
  type,
  shortLink: false,
  date: inDays(2).toISOString(),
  tags: [],
  posts: [
    {
      integration: { id: channel },
      value: [{ content, image: [] }],
      settings: { __type: 'bluesky' },
    },
  ],
});

const fill = (
  orgId: string,
  integrationId: string,
  count: number,
  data: { state: 'QUEUE' | 'PUBLISHED' | 'DRAFT'; publishDate: Date; deletedAt?: Date }
) =>
  prisma.post.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      organizationId: orgId,
      integrationId,
      content: `[stack] filler ${i}`,
      group: `stack-filler-${orgId}-${data.state}-${i}`,
      ...data,
    })),
  });

test('Starter with 400 queued and published posts this cycle cannot schedule another', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1 });
  const [channel] = org.channelIds;
  await fill(org.orgId, channel, 300, { state: 'QUEUE', publishDate: inDays(1) });
  await fill(org.orgId, channel, 100, { state: 'PUBLISHED', publishDate: new Date() });

  const res = await org.api.post('/posts', { data: body(channel, 'schedule', '[stack] 401st') });
  expect(res.status()).toBe(402);
  expect((await res.json()).message).toContain('maximum number of posts');

  // The public API asks the same question.
  const key = (await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).apiKey!;
  const publicApi = await request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: key },
  });
  expect(
    (await publicApi.post('posts', { data: body(channel, 'schedule', '[stack] 401st') })).status()
  ).toBe(402);
  await publicApi.dispose();

  expect(await prisma.post.count({ where: { organizationId: org.orgId } })).toBe(400);
  await org.remove();
});

test('Starter at 400 posts can still save a draft', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1 });
  const [channel] = org.channelIds;
  await fill(org.orgId, channel, 400, { state: 'QUEUE', publishDate: inDays(1) });
  try {
    const res = await org.api.post('/posts', { data: body(channel, 'draft', '[stack] draft at cap') });
    expect(res.status(), await res.text()).toBe(201);
  } finally {
    await org.remove();
  }
});

test('drafts, deleted posts and earlier cycles do not count towards the 400', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1 });
  const [channel] = org.channelIds;
  await fill(org.orgId, channel, 400, { state: 'DRAFT', publishDate: inDays(1) });
  await fill(org.orgId, channel, 400, { state: 'QUEUE', publishDate: inDays(1), deletedAt: new Date() });
  // The subscription started now; these belong to the cycle before it.
  await fill(org.orgId, channel, 400, { state: 'PUBLISHED', publishDate: inDays(-3) });

  // Past the allowance check, stopped by validation: nothing is scheduled.
  const res = await org.api.post('/posts', { data: body(channel, 'schedule', '') });
  expect(res.status(), await res.text()).toBe(400);
  await org.remove();
});

test('E2E-07-22: at the cap, the public API cannot turn a draft into a scheduled post', async () => {
  // Drafts are free; flipping one to "schedule" through PUT /posts/:id/status
  // skipped the monthly allowance and queued it anyway.
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1 });
  const [channel] = org.channelIds;
  try {
    await fill(org.orgId, channel, 400, { state: 'QUEUE', publishDate: inDays(1) });
    const draft = await prisma.post.create({
      data: { organizationId: org.orgId, integrationId: channel, content: '[stack] draft', group: `stack-draft-${org.orgId}`, state: 'DRAFT', publishDate: inDays(2) },
    });
    const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
    const publicApi = await request.newContext({ baseURL: `${BACKEND_URL}/public/v1/`, extraHTTPHeaders: { authorization: apiKey! } });
    const res = await publicApi.put(`posts/${draft.id}/status`, { data: { status: 'schedule' } });
    expect(res.status(), await res.text()).toBe(402);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe('DRAFT');
    await publicApi.dispose();
  } finally {
    await org.remove();
  }
});

// BILL-4 / POSTS-12: the check was `count < limit`, so with one post left a
// single save on several channels (or a thread) went through in full.
test('one post left: a save on two channels is refused, on one it goes through', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 2 });
  const [first, second] = org.channelIds;
  await fill(org.orgId, first, 399, { state: 'QUEUE', publishDate: inDays(1) });

  const twoChannels = body(first, 'schedule', '[stack] two channels');
  twoChannels.posts.push({ ...twoChannels.posts[0], integration: { id: second } });
  expect((await org.api.post('/posts', { data: twoChannels })).status()).toBe(402);

  const thread = body(first, 'schedule', '[stack] thread');
  thread.posts[0].value.push({ content: '[stack] part two', image: [] });
  expect((await org.api.post('/posts', { data: thread })).status()).toBe(402);

  expect((await org.api.post('/posts', { data: body(first, 'schedule', '[stack] the 400th') })).status()).toBe(201);
  await org.remove();
});
