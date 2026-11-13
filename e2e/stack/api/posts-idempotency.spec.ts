import { APIRequestContext, expect, request, test } from '@playwright/test';
import { BACKEND_URL, channelOf, database, draftBody, listPosts, signedIn, throwawayOrg } from '../helpers';
import { USERS } from '../seed';

// A phone on a slow connection timed out on "Save", retried, and the post was
// saved twice. A retry with the same Idempotency-Key gets the first answer.
let api: APIRequestContext;
test.beforeAll(async () => {
  api = await signedIn('a');
});
test.afterAll(async () => api.dispose());

test('a retry with the same Idempotency-Key saves the post once', async () => {
  const content = `[stack] idempotent ${Date.now()}`;
  const key = `stack-${Date.now()}-retry`;
  const body = draftBody('a', content);
  const first = await api.post('/posts', { data: body, headers: { 'Idempotency-Key': key } });
  expect(first.status(), await first.text()).toBe(201);
  const again = await api.post('/posts', { data: body, headers: { 'Idempotency-Key': key } });
  expect(again.status(), await again.text()).toBe(201);
  expect(await again.json()).toEqual(await first.json());
  expect((await listPosts(api)).filter((p) => p.content === content)).toHaveLength(1);

  const other = await api.post('/posts', { data: draftBody('a', `${content} changed`), headers: { 'Idempotency-Key': key } });
  expect(other.status()).toBe(422);

  const posts = (await listPosts(api)).filter((p) => p.content.startsWith(content));
  for (const p of posts) await api.delete(`/posts/${p.group}`);
});

test('without the header nothing changes: two requests, two posts', async () => {
  const content = `[stack] no key ${Date.now()}`;
  for (let i = 0; i < 2; i++) {
    const res = await api.post('/posts', { data: draftBody('a', content) });
    expect(res.status()).toBe(201);
  }
  const posts = (await listPosts(api)).filter((p) => p.content === content);
  expect(posts).toHaveLength(2);
  for (const p of posts) await api.delete(`/posts/${p.group}`);
});

// The last post of the month used up the allowance; its retry (the phone
// never saw the answer) must get that answer back, not a 402.
test('the retry of the post that used the last of the allowance gets its answer, not a 402', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1 });
  const [channel] = org.channelIds;
  try {
    await prisma.post.createMany({
      data: Array.from({ length: 399 }, (_, i) => ({
        organizationId: org.orgId,
        integrationId: channel,
        content: `[stack] filler ${i}`,
        group: `stack-idem-filler-${org.orgId}-${i}`,
        state: 'QUEUE' as const,
        publishDate: new Date(Date.now() + 86_400_000),
      })),
    });
    const body = {
      type: 'schedule',
      shortLink: false,
      date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      tags: [],
      posts: [{ integration: { id: channel }, value: [{ content: '[stack] the 400th', image: [] }], settings: { __type: 'bluesky' } }],
    };
    const key = `stack-${Date.now()}-last`;
    const first = await org.api.post('/posts', { data: body, headers: { 'Idempotency-Key': key } });
    expect(first.status(), await first.text()).toBe(201);
    const again = await org.api.post('/posts', { data: body, headers: { 'Idempotency-Key': key } });
    expect(again.status(), await again.text()).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    // A new post is still refused: the allowance is used up.
    const another = await org.api.post('/posts', { data: { ...body, posts: [{ ...body.posts[0], value: [{ content: '[stack] 401st', image: [] }] }] } });
    expect(another.status()).toBe(402);
    expect(await prisma.post.count({ where: { organizationId: org.orgId, deletedAt: null } })).toBe(400);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

// The public API is where retries come from most (scripts, Zapier, n8n),
// and it ignored the header: a retry saved the post a second time.
test('the public API: a retry with the same Idempotency-Key saves the post once', async () => {
  const prisma = database();
  const keyed = await request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: USERS.a.apiKey },
  });
  const content = `[stack] public idempotent ${Date.now()}`;
  try {
    const body = {
      type: 'draft',
      shortLink: false,
      date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      tags: [],
      posts: [{ integration: { id: channelOf('a') }, value: [{ content, image: [] }], settings: { __type: 'bluesky' } }],
    };
    const key = `stack-${Date.now()}-public`;
    const first = await keyed.post('posts', { data: body, headers: { 'Idempotency-Key': key } });
    expect(first.status(), await first.text()).toBe(201);
    const again = await keyed.post('posts', { data: body, headers: { 'Idempotency-Key': key } });
    expect(again.status(), await again.text()).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    expect(await prisma.post.count({ where: { content: { contains: content }, deletedAt: null } })).toBe(1);

    const other = await keyed.post('posts', {
      data: { ...body, posts: [{ ...body.posts[0], value: [{ content: `${content} changed`, image: [] }] }] },
      headers: { 'Idempotency-Key': key },
    });
    expect(other.status()).toBe(422);
    const bad = await keyed.post('posts', { data: body, headers: { 'Idempotency-Key': 'short' } });
    expect(bad.status()).toBe(400);
  } finally {
    const left = await prisma.post.findMany({ where: { content: { contains: content } }, select: { group: true } });
    for (const { group } of left) await keyed.delete(`posts/group/${group}`);
    await keyed.dispose();
    await prisma.$disconnect();
  }
});
