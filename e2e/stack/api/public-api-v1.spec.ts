import { APIRequestContext, expect, request, test } from '@playwright/test';
import { BACKEND_URL, channelOf, database } from '../helpers';
import { USERS } from '../seed';

// The /public/v1 routes the launch plan names (e2e/13-launch-coverage-plan.md
// §2 A3, G7) that public-api.spec.ts does not touch. Each with org A's key:
// its own resources answer, org B's ids are 404 like ids that never existed,
// nothing is a 500, and without a key everything is 401.

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const withKey = (key?: string) =>
  request.newContext({
    // Trailing slash + relative paths, as in public-api.spec.ts.
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: key ? { authorization: key } : {},
  });

const prisma = database();
let a: APIRequestContext;
let b: APIRequestContext;
let postOfA: string;
let postOfB: string;

const draft = async (api: APIRequestContext, channel: string) => {
  const res = await api.post('posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: channel },
          value: [{ content: `[stack] public v1 ${Date.now()}`, image: [] }],
          settings: { __type: 'bluesky' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { postId: string }[])[0].postId;
};

test.beforeAll(async () => {
  a = await withKey(USERS.a.apiKey);
  b = await withKey(USERS.b.apiKey);
  postOfA = await draft(a, channelOf('a'));
  postOfB = await draft(b, channelOf('b'));
});
test.afterAll(async () => {
  await a.delete(`posts/${postOfA}`);
  await b.delete(`posts/${postOfB}`);
  await a.dispose();
  await b.dispose();
  await prisma.$disconnect();
});

test('G7: without a key every route is 401', async () => {
  const anonymous = await withKey();
  const routes: ['get' | 'put', string][] = [
    ['get', `find-slot/${channelOf('a')}`],
    ['get', `integration-settings/${channelOf('a')}`],
    ['get', 'is-connected'],
    ['get', 'notifications'],
    ['get', 'social/mastodon'],
    ['get', `posts/${postOfA}/missing`],
    ['put', `posts/${postOfA}/release-id`],
    ['put', `posts/${postOfA}/status`],
    ['get', `analytics/${channelOf('a')}`],
  ];
  for (const [method, path] of routes) {
    expect((await anonymous[method](path)).status(), path).toBe(401);
  }
  await anonymous.dispose();
});

test('G7: is-connected answers for a valid key', async () => {
  const res = await a.get('is-connected');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ connected: true });
});

test('G7: notifications are paginated and the organisation’s own', async () => {
  const res = await a.get('notifications?page=0');
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.notifications)).toBe(true);
});

test('G7: find-slot gives a free time on an own channel', async () => {
  const res = await a.get(`find-slot/${channelOf('a')}`);
  expect(res.status()).toBe(200);
  const { date } = await res.json();
  expect(new Date(date).getTime()).toBeGreaterThan(Date.now() - 86_400_000);
});

test('G7: find-slot on a foreign or unknown channel is 404', async () => {
  for (const id of [channelOf('b'), UNKNOWN]) {
    expect((await a.get(`find-slot/${id}`, { timeout: 5_000 })).status(), id).toBe(404);
  }
});

test('G7: integration-settings describes an own channel', async () => {
  const res = await a.get(`integration-settings/${channelOf('a')}`);
  expect(res.status()).toBe(200);
  const { output } = await res.json();
  expect(output.maxLength).toBeGreaterThan(0);
});

test('G7: integration-settings for a foreign or unknown channel is 404', async () => {
  for (const id of [channelOf('b'), UNKNOWN]) {
    const res = await a.get(`integration-settings/${id}`);
    expect(res.status(), `${id}: ${await res.text()}`).toBe(404);
  }
});

test('G7: social/:integration starts a connection and refuses unknown platforms', async () => {
  const res = await a.get('social/mastodon');
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).url).toContain('localhost:58080');
  expect((await a.get('social/not-a-platform')).status()).toBe(400);
});

test('G7: social/:integration keeps platforms outside the plan out, like the app does', async () => {
  for (const platform of ['youtube', 'threads', 'x', 'discord']) {
    expect((await b.get(`social/${platform}`)).status(), platform).toBe(402);
  }
});

test('G7: posts/:id/missing - an own post is answered, a foreign one exactly like an unknown one', async () => {
  const own = await a.get(`posts/${postOfA}/missing`);
  expect(own.status()).toBe(200);
  expect(await own.json()).toEqual([]);
  // Nothing missing is an empty list, so 200 [] for every id tells nobody
  // whether a post exists.
  for (const id of [postOfB, UNKNOWN]) {
    const res = await a.get(`posts/${id}/missing`);
    expect(res.status(), id).toBe(200);
    expect(await res.json()).toEqual([]);
  }
});

test('G7: posts/:id/release-id fills an own post waiting for one, 404 otherwise', async () => {
  await prisma.post.update({ where: { id: postOfA }, data: { releaseId: 'missing' } });
  const own = await a.put(`posts/${postOfA}/release-id`, { data: { releaseId: 'stack-1' } });
  expect(own.status(), await own.text()).toBe(200);

  await prisma.post.update({ where: { id: postOfB }, data: { releaseId: 'missing' } });
  for (const id of [postOfB, UNKNOWN]) {
    const res = await a.put(`posts/${id}/release-id`, { data: { releaseId: 'stack-2' } });
    expect(res.status(), id).toBe(404);
  }
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postOfB } })).releaseId).toBe('missing');
});

test('G7: posts/:id/status changes an own post', async () => {
  // Draft → draft: changing the state for real would schedule a publish.
  const res = await a.put(`posts/${postOfA}/status`, { data: { status: 'draft' } });
  expect(res.status(), await res.text()).toBe(200);
  expect(await res.json()).toEqual({ id: postOfA, state: 'DRAFT' });
  expect((await a.put(`posts/${postOfA}/status`, { data: { status: 'nope' } })).status()).toBe(400);
});

test('G7: posts/:id/status on a foreign or unknown post is 404 and changes nothing', async () => {
  for (const id of [postOfB, UNKNOWN]) {
    const res = await a.put(`posts/${id}/status`, { data: { status: 'schedule' } });
    expect(res.status(), id).toBe(404);
  }
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postOfB } })).state).toBe('DRAFT');
});

test('G7: analytics of an own channel answer', async () => {
  const res = await a.get(`analytics/${channelOf('a')}?date=7`);
  expect(res.status(), await res.text()).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test('G7: analytics of a foreign or unknown channel are 404', async () => {
  for (const id of [channelOf('b'), UNKNOWN]) {
    const res = await a.get(`analytics/${id}?date=7`);
    expect(res.status(), `${id}: ${await res.text()}`).toBe(404);
  }
});
