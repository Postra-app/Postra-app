import { APIRequestContext, expect, request, test } from '@playwright/test';
import { BACKEND_URL, listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';

// A published post must not go out a second time by accident (upstream
// b6310364). The dashboard asked first, but the API did not: moving the post
// with action "schedule" (the default when no action was sent), saving it
// again as "now"/"schedule", or setting its status to "schedule" through the
// public API put it back in the queue — and with its past date the workflow
// published it again at once. Now each of these is a 400 unless the caller
// sends `republish: true`, and the post stays as it was.

const FAKE = 'http://localhost:58080';
const CHANNEL = USERS.a.mastodon.id;

let api: APIRequestContext;
let publicApi: APIRequestContext;
test.beforeAll(async () => {
  api = await signedIn('a');
  publicApi = await request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: USERS.a.apiKey },
  });
});
test.afterAll(async () => {
  await api.dispose();
  await publicApi.dispose();
});

// One post, published once, then every way of requeueing it in turn.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const timesSent = async (content: string) =>
  ((await (await api.get(`${FAKE}/__received`)).json()) as { status: string }[]).filter(
    (r) => r.status === content
  ).length;

const stored = async (id: string) => (await (await api.get(`/posts/${id}`)).json());

const settled = (id: string) =>
  expect.poll(async () => (await stored(id)).posts[0].state, {
    timeout: 90_000,
    intervals: [500, 1_000, 2_000],
  });

const content = `[stack] published once ${Date.now()}`;
let id: string;
let group: string;
let publishedAt: string;

test('the post is published once', async () => {
  const res = await api.post('/posts', {
    data: {
      type: 'now',
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: CHANNEL },
          value: [{ content, image: [] }],
          settings: { __type: 'mastodon' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  id = (await listPosts(api)).find((p) => p.content.includes(content))!.id;
  await settled(id).toBe('PUBLISHED');
  const post = await stored(id);
  group = post.group;
  publishedAt = post.posts[0].publishDate;
  expect(await timesSent(content)).toBe(1);
});

test('moving it without an action only changes the date', async () => {
  const res = await api.put(`/posts/${id}/date`, { data: { date: publishedAt } });
  expect(res.status(), await res.text()).toBe(200);
  // Long enough for a requeued post to have gone out again.
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  expect((await stored(id)).posts[0].state).toBe('PUBLISHED');
  expect(await timesSent(content)).toBe(1);
});

test('moving it with action "schedule" is refused and explained', async () => {
  const res = await api.put(`/posts/${id}/date`, {
    data: { date: publishedAt, action: 'schedule' },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).message).toContain('already published');
  const post = (await stored(id)).posts[0];
  expect(post.state).toBe('PUBLISHED');
  expect(post.releaseURL).toBeTruthy();
});

test('saving it again as "now" is refused before anything is written', async () => {
  const res = await api.post('/posts', {
    data: {
      type: 'now',
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: CHANNEL },
          group,
          value: [{ id, content: `${content} edited`, image: [] }],
          settings: { __type: 'mastodon' },
        },
      ],
    },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).message).toContain('republish: true');
  const post = (await stored(id)).posts[0];
  expect(post.state).toBe('PUBLISHED');
  expect(post.content).toBe(content);
});

test('the public API cannot put it back in the queue', async () => {
  const res = await publicApi.put(`posts/${id}/status`, { data: { status: 'schedule' } });
  expect(res.status()).toBe(400);
  expect((await stored(id)).posts[0].state).toBe('PUBLISHED');
});

test('nothing above reached the platform a second time', async () => {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  expect(await timesSent(content)).toBe(1);
});

test('republish: true still publishes it again, once', async () => {
  const res = await api.put(`/posts/${id}/date`, {
    data: { date: new Date().toISOString(), action: 'schedule', republish: true },
  });
  expect(res.status(), await res.text()).toBe(200);
  await expect
    .poll(() => timesSent(content), { timeout: 90_000, intervals: [500, 1_000, 2_000] })
    .toBe(2);
  await settled(id).toBe('PUBLISHED');
});
