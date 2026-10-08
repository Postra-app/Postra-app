import { APIRequestContext, expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// Group schedules (upstream a194e3f4): the channels of one save share a
// batch, so opening one of them in the editor brings the others, each with
// its own content and date. Editing or deleting one channel leaves the others
// as they are.

const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 19);

type Opened = {
  group: string;
  integration: string;
  posts: { id: string; content: string; publishDate: string; updatedAt: string; integration?: Record<string, unknown> }[];
  siblings: Opened[];
};

const open = async (api: APIRequestContext, group: string) => {
  const res = await api.get(`/posts/group/${group}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Opened;
};

const channelPost = (channel: string, content: string, extra: Record<string, unknown> = {}) => ({
  integration: { id: channel },
  value: [{ content, image: [] }],
  settings: { __type: 'bluesky' },
  ...extra,
});

const groupOf = async (postId: string) =>
  (await prisma.post.findUniqueOrThrow({ where: { id: postId } })).group;

test('a save for two channels opens with the other channel; each keeps its content and date', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 3 });
  try {
    const [a, b, c] = org.channelIds;
    const saved = await org.api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: inDays(2),
        tags: [],
        posts: [
          channelPost(a, 'for A'),
          // A channel with a date of its own (the editor sends one for the
          // other channels of an existing post).
          channelPost(b, 'for B', { date: inDays(3) }),
        ],
      },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    const [postA, postB] = (await saved.json()) as { postId: string }[];

    const rows = await prisma.post.findMany({ where: { id: { in: [postA.postId, postB.postId] } } });
    expect(rows[0].batchId).toBeTruthy();
    expect(rows[1].batchId).toBe(rows[0].batchId);
    const dateOf = (id: string) => rows.find((r) => r.id === id)!.publishDate.toISOString().slice(0, 10);
    expect(dateOf(postA.postId)).toBe(inDays(2).slice(0, 10));
    expect(dateOf(postB.postId)).toBe(inDays(3).slice(0, 10));

    const openedA = await open(org.api, await groupOf(postA.postId));
    expect(openedA.integration).toBe(a);
    expect(openedA.siblings).toHaveLength(1);
    expect(openedA.siblings[0].integration).toBe(b);
    expect(openedA.siblings[0].posts[0].content).toContain('for B');
    // The sibling's channel comes without its tokens, like the opened one.
    for (const channel of [openedA.posts[0].integration, openedA.siblings[0].posts[0].integration]) {
      expect(channel).toBeTruthy();
      expect(channel).not.toHaveProperty('token');
      expect(channel).not.toHaveProperty('refreshToken');
    }

    const openedB = await open(org.api, await groupOf(postB.postId));
    expect(openedB.siblings.map((s) => s.integration)).toEqual([a]);

    // A post saved on its own has no siblings.
    const single = await org.api.post('/posts', {
      data: { type: 'draft', shortLink: false, date: inDays(2), tags: [], posts: [channelPost(c, 'alone')] },
    });
    expect(single.status()).toBe(201);
    const alone = await open(org.api, await groupOf(((await single.json()) as { postId: string }[])[0].postId));
    expect(alone.siblings).toEqual([]);
  } finally {
    await org.remove();
  }
});

test('editing one channel on its own keeps it in the batch and leaves the other untouched', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 2 });
  try {
    const [a, b] = org.channelIds;
    const saved = await org.api.post('/posts', {
      data: { type: 'draft', shortLink: false, date: inDays(2), tags: [], posts: [channelPost(a, 'A one'), channelPost(b, 'B one')] },
    });
    expect(saved.status()).toBe(201);
    const [postA, postB] = (await saved.json()) as { postId: string }[];
    const before = await prisma.post.findUniqueOrThrow({ where: { id: postB.postId } });

    const openedA = await open(org.api, await groupOf(postA.postId));
    const edit = await org.api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: inDays(4),
        tags: [],
        posts: [{ ...channelPost(a, 'A two'), group: openedA.group, value: [{ id: postA.postId, content: 'A two', image: [] }] }],
      },
    });
    expect(edit.status(), await edit.text()).toBe(201);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: postB.postId } });
    expect(after.content).toBe(before.content);
    expect(after.group).toBe(before.group);
    expect(after.publishDate.toISOString()).toBe(before.publishDate.toISOString());

    const reopened = await open(org.api, await groupOf(postA.postId));
    expect(reopened.posts[0].content).toContain('A two');
    expect(reopened.siblings.map((s) => s.integration)).toEqual([b]);
  } finally {
    await org.remove();
  }
});

test('deleting one channel keeps the other, which then opens alone', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 2 });
  try {
    const [a, b] = org.channelIds;
    const saved = await org.api.post('/posts', {
      data: { type: 'draft', shortLink: false, date: inDays(2), tags: [], posts: [channelPost(a, 'A'), channelPost(b, 'B')] },
    });
    const [postA, postB] = (await saved.json()) as { postId: string }[];

    expect((await org.api.delete(`/posts/${await groupOf(postA.postId)}`)).status()).toBe(200);
    const openedB = await open(org.api, await groupOf(postB.postId));
    expect(openedB.posts[0].content).toContain('B');
    expect(openedB.siblings).toEqual([]);
  } finally {
    await org.remove();
  }
});

test('the public API keeps one date per request and the public preview has no batch', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 2 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const api = await request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: apiKey! },
  });
  try {
    const [a, b] = org.channelIds;
    const res = await api.post('posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: inDays(2),
        tags: [],
        posts: [channelPost(a, 'api A'), channelPost(b, 'api B', { date: inDays(5) })],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const ids = ((await res.json()) as { postId: string }[]).map((p) => p.postId);
    const rows = await prisma.post.findMany({ where: { id: { in: ids } } });
    expect(rows.map((r) => r.publishDate.toISOString().slice(0, 10))).toEqual([inDays(2).slice(0, 10), inDays(2).slice(0, 10)]);
    expect(rows[1].batchId).toBe(rows[0].batchId);

    const preview = await org.api.get(`/public/posts/${ids[0]}`);
    expect(preview.status()).toBe(200);
    for (const post of (await preview.json()) as Record<string, unknown>[]) {
      expect(post).not.toHaveProperty('batchId');
    }
  } finally {
    await api.dispose();
    await org.remove();
  }
});

// Codex: the editor saved the channels of one post in a request per type
// (one kept as a draft, another scheduled), so a refusal on the second request
// left the first one saved. One request now carries every channel, each with
// the type it is saved as.
const mixed = (api: APIRequestContext, type: string, posts: Record<string, unknown>[]) =>
  api.post('/posts', { data: { type, shortLink: false, date: inDays(2), tags: [], posts } });

const fillCap = (orgId: string, channel: string, n: number) =>
  prisma.post.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      id: `mixed-${orgId}-${i}`,
      organizationId: orgId,
      integrationId: channel,
      content: `cap ${i}`,
      group: `mixed-${orgId}-${i}`,
      publishDate: new Date(Date.now() + 86_400_000),
      state: 'QUEUE' as const,
    })),
  });

test('one save schedules one channel and keeps the other a draft, which the cap does not count', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 2 });
  try {
    const [a, b] = org.channelIds;
    // Starter allows 400 posts a month: room for one more.
    await fillCap(org.orgId, a, 399);
    const saved = await mixed(org.api, 'schedule', [
      channelPost(a, 'scheduled', { type: 'schedule' }),
      channelPost(b, 'kept as a draft', { type: 'draft' }),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const [postA, postB] = (await saved.json()) as { postId: string }[];
    const stateOf = async (id: string) => (await prisma.post.findUniqueOrThrow({ where: { id } })).state;
    expect(await stateOf(postA.postId)).toBe('QUEUE');
    expect(await stateOf(postB.postId)).toBe('DRAFT');
    const [rowA, rowB] = await prisma.post.findMany({ where: { id: { in: [postA.postId, postB.postId] } } });
    expect(rowA.batchId).toBe(rowB.batchId);

    // A request called a draft with a channel scheduled in it is not free.
    const sneaky = await mixed(org.api, 'draft', [channelPost(a, 'not a draft', { type: 'schedule' })]);
    expect(sneaky.status(), await sneaky.text()).toBe(402);
  } finally {
    await org.remove();
  }
});

test('a channel refused in a save leaves the other channels of it unsaved', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 2 });
  try {
    const [a, b] = org.channelIds;
    const res = await mixed(org.api, 'draft', [
      channelPost(a, 'a draft', { type: 'draft' }),
      // Bluesky takes 300 characters; a draft may be longer, a scheduled post not.
      channelPost(b, 'x'.repeat(400), { type: 'schedule' }),
    ]);
    expect(res.status(), await res.text()).toBe(400);
    expect(await prisma.post.count({ where: { organizationId: org.orgId, deletedAt: null } })).toBe(0);

    // The same text kept as a draft on both is fine.
    const drafts = await mixed(org.api, 'schedule', [
      channelPost(a, 'a draft', { type: 'draft' }),
      channelPost(b, 'x'.repeat(400), { type: 'draft' }),
    ]);
    expect(drafts.status(), await drafts.text()).toBe(201);
    expect(await prisma.post.count({ where: { organizationId: org.orgId, deletedAt: null, state: 'DRAFT' } })).toBe(2);

    const unknown = await mixed(org.api, 'draft', [channelPost(a, 'odd', { type: 'later' })]);
    expect(unknown.status(), await unknown.text()).toBe(400);
  } finally {
    await org.remove();
  }
});

// Codex: one save gave every channel the request's tags, so saving the post
// from one channel replaced the tags another channel had.
test('each channel of a save can keep tags of its own', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 2 });
  try {
    const [a, b] = org.channelIds;
    await prisma.tags.createMany({
      data: ['alpha', 'beta'].map((name) => ({ orgId: org.orgId, name, color: '#38bdf8' })),
    });
    const tag = (name: string) => [{ value: name, label: name }];
    const saved = await mixed(org.api, 'draft', [
      channelPost(a, 'tagged alpha', { tags: tag('alpha') }),
      channelPost(b, 'tagged beta', { tags: tag('beta') }),
    ]);
    expect(saved.status(), await saved.text()).toBe(201);
    const [postA, postB] = (await saved.json()) as { postId: string }[];
    const tagsOf = async (id: string) =>
      (await prisma.tagsPosts.findMany({ where: { postId: id }, include: { tag: true } })).map((t) => t.tag.name);
    expect(await tagsOf(postA.postId)).toEqual(['alpha']);
    expect(await tagsOf(postB.postId)).toEqual(['beta']);
  } finally {
    await org.remove();
  }
});
