import { expect, test } from '@playwright/test';
import { database, listPosts, signedIn, throwawayOrg } from '../helpers';
import { USERS } from '../seed';

// Post statistics (calendar → Post Statistics) for Mastodon and Bluesky,
// which had none: Help said so, while the landing promised analytics for
// every channel (K. 2026-10-07). The fake Mastodon also answers Bluesky's
// public AppView (stack.env BLUESKY_APPVIEW_URL).

const FAKE = 'http://localhost:58080';
const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

const counts = (data: { label: string; data: { total: string }[] }[]) =>
  Object.fromEntries(data.map((m) => [m.label, m.data[0]?.total]));

test('a published Mastodon post has favourites, boosts and replies', async () => {
  test.setTimeout(120_000);
  const api = await signedIn('a');
  const content = `[stack] statistics ${Date.now()}`;
  try {
    const res = await api.post('/posts', {
      data: {
        type: 'now',
        shortLink: false,
        date: new Date().toISOString(),
        tags: [],
        posts: [{ integration: { id: USERS.a.mastodon.id }, value: [{ content, image: [] }], settings: { __type: 'mastodon' } }],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    await expect
      .poll(
        async () => ((await (await api.get(`${FAKE}/__received`)).json()) as { status: string }[]).some((r) => r.status === content),
        { timeout: 90_000, intervals: [1_000, 2_000] }
      )
      .toBe(true);
    const id = (await listPosts(api)).find((p) => p.content.includes(content))!.id;
    await expect
      .poll(async () => counts(await (await api.get(`/analytics/post/${id}?date=7`)).json()), { timeout: 30_000 })
      .toEqual({ Favourites: '3', Boosts: '2', Replies: '1' });
  } finally {
    await api.dispose();
  }
});

test('a published Bluesky post has likes, reposts, replies and quotes', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const post = await prisma.post.create({
      data: {
        organizationId: org.orgId,
        integrationId: org.channelIds[0],
        content: 'published',
        group: `stats-${org.orgId}`,
        publishDate: new Date(),
        state: 'PUBLISHED',
        releaseId: 'at://did:plc:stack/app.bsky.feed.post/3stackpost',
      },
    });
    const res = await org.api.get(`/analytics/post/${post.id}?date=7`);
    expect(res.status()).toBe(200);
    expect(counts(await res.json())).toEqual({ Likes: '5', Reposts: '4', Replies: '3', Quotes: '2' });
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});
