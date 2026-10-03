import { APIRequestContext, expect, test } from '@playwright/test';
import { database, listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';

// Publishing end to end: API → Temporal → orchestrator → the real Mastodon
// provider → e2e/stack/fake-mastodon.mjs. On production this path can only be
// watched, never exercised; here it runs on every pull request.

const FAKE = 'http://localhost:58080';
const CHANNEL = USERS.a.mastodon.id;

type Received = { id: string; status: string; authorization: string | null };
type StoredPost = {
  id: string;
  state: string;
  releaseURL: string | null;
  error: string | null;
};

let api: APIRequestContext;
test.beforeAll(async () => {
  api = await signedIn('a');
});
test.afterAll(async () => {
  await api.dispose();
});

// Publishing touches shared state (the fake's failure switch), so these run
// one after another. A fresh Temporal worker on a CI runner takes ~25 s to
// pick up the first post (11 s locally), hence the generous limits.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const received = async (): Promise<Received[]> =>
  (await (await api.get(`${FAKE}/__received`)).json()) as Received[];

const publish = async (content: string, type: 'now' | 'schedule', date: Date) => {
  const res = await api.post('/posts', {
    data: {
      type,
      shortLink: false,
      date: date.toISOString(),
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
  const post = (await listPosts(api)).find((p) => p.content.includes(content));
  expect(post, 'post is in the calendar').toBeTruthy();
  return post!;
};

const stored = async (id: string): Promise<StoredPost> =>
  (await (await api.get(`/posts/${id}`)).json()).posts[0];

const settledState = (id: string) =>
  expect.poll(async () => (await stored(id)).state, {
    timeout: 90_000,
    intervals: [500, 1_000, 2_000],
  });

test('"Post now" reaches the platform and the post is marked published', async () => {
  const content = `[stack] post now ${Date.now()}`;
  const post = await publish(content, 'now', new Date());

  await settledState(post.id).toBe('PUBLISHED');

  const sent = (await received()).find((r) => r.status === content);
  expect(sent, 'the platform got the text unchanged').toBeTruthy();
  // The token is stored encrypted; the provider must get it decrypted.
  expect(sent!.authorization).toBe('Bearer stack-mastodon-token');

  const after = await stored(post.id);
  expect(after.releaseURL).toBe(`${FAKE}/statuses/${sent!.id}`);
  expect(after.error ?? null).toBeNull();
});

test('a scheduled post waits for its time, then publishes', async () => {
  const content = `[stack] scheduled ${Date.now()}`;
  const at = new Date(Date.now() + 15_000);
  const post = await publish(content, 'schedule', at);

  expect((await stored(post.id)).state).toBe('QUEUE');
  expect((await received()).some((r) => r.status === content)).toBe(false);

  await settledState(post.id).toBe('PUBLISHED');
  expect((await received()).some((r) => r.status === content)).toBe(true);
});

test('a platform refusal marks the post failed, with the reason', async () => {
  const content = `[stack] refused ${Date.now()}`;
  expect((await api.post(`${FAKE}/__fail`, { data: { match: content } })).ok()).toBe(true);
  const post = await publish(content, 'now', new Date());

  await settledState(post.id).toBe('ERROR');
  const after = await stored(post.id);
  expect(after.releaseURL).toBeFalsy();
  // E2E-05-10: the platform's own reason in one readable sentence — not
  // Temporal's JSON with stack traces and container paths.
  expect(after.error).toContain('Text character limit of 500 exceeded');
  expect(after.error).not.toMatch(/\bat \w+|\/app\/|node_modules|workflowId/);
});

// Editing a scheduled post (composer → save with the same post id): the old
// workflow is stopped and a new one publishes the new text, once (S2,
// 05-composer-publish.md §5.3 "Edit zaplanowanego").
test('an edited scheduled post publishes the new text, once', async () => {
  const tag = Date.now();
  const original = `[stack] before edit ${tag}`;
  const edited = `[stack] after edit ${tag}`;
  const at = new Date(Date.now() + 20_000);
  const post = await publish(original, 'schedule', at);
  const { group } = await (await api.get(`/posts/${post.id}`)).json();

  const res = await api.post('/posts', {
    data: {
      type: 'schedule',
      shortLink: false,
      date: at.toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: CHANNEL },
          group,
          value: [{ id: post.id, content: edited, image: [] }],
          settings: { __type: 'mastodon' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);

  await settledState(post.id).toBe('PUBLISHED');
  // Give a leftover workflow for the old text time to fire, if there were one.
  await new Promise((r) => setTimeout(r, 5_000));
  const sent = (await received()).filter((r) => r.status.includes(`${tag}`));
  expect(sent.map((r) => r.status)).toEqual([edited]);
});

// "Duplicate" on a calendar tile: a new post with the same text, its own id,
// and the original untouched.
test('duplicating a post makes an independent copy', async () => {
  const content = `[stack] duplicate me ${Date.now()}`;
  const post = await publish(content, 'schedule', new Date(Date.now() + 3 * 86_400_000));
  try {
    const original = await (await api.get(`/posts/${post.id}`)).json();
    const copy = await api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: new Date(Date.now() + 4 * 86_400_000).toISOString(),
        tags: [],
        posts: [
          {
            integration: { id: CHANNEL },
            value: original.posts.map((p: { content: string }) => ({ content: p.content, image: [] })),
            settings: original.settings,
          },
        ],
      },
    });
    expect(copy.status()).toBe(201);
    const both = (await listPosts(api)).filter((p) => p.content === content);
    expect(both).toHaveLength(2);
    expect(new Set(both.map((p) => p.group)).size).toBe(2);
    expect((await stored(post.id)).state).toBe('QUEUE');
    for (const p of both) await api.delete(`/posts/${p.group}`);
  } catch (e) {
    await api.delete(`/posts/${post.group}`);
    throw e;
  }
});

// §5.4 error paths: the channel goes bad between scheduling and publishing.
// The post fails with a plain reason, the team is told in the app, and
// nothing reaches the platform. The channel is restored in `finally`: the
// other tests here publish through it.
const notifications = async (): Promise<string> =>
  JSON.stringify(await (await api.get('/notifications/list')).json());

test('a channel disabled before publish time: the post fails as "Channel disabled"', async () => {
  const content = `[stack] disabled channel ${Date.now()}`;
  const post = await publish(content, 'schedule', new Date(Date.now() + 12_000));
  expect((await api.post('/integrations/disable', { data: { id: CHANNEL } })).status()).toBe(201);
  try {
    await settledState(post.id).toBe('ERROR');
    expect((await stored(post.id)).error).toBe('Channel disabled');
    expect(await notifications()).toContain("because it's disabled");
    expect((await received()).some((r) => r.status === content)).toBe(false);
  } finally {
    expect((await api.post('/integrations/enable', { data: { id: CHANNEL } })).status()).toBe(201);
  }
});

test('a channel that needs reconnecting: the post fails as "Refresh channel needed"', async () => {
  const content = `[stack] refresh needed ${Date.now()}`;
  const post = await publish(content, 'schedule', new Date(Date.now() + 12_000));
  const prisma = database();
  await prisma.integration.update({ where: { id: CHANNEL }, data: { refreshNeeded: true } });
  try {
    await settledState(post.id).toBe('ERROR');
    expect((await stored(post.id)).error).toBe('Refresh channel needed');
    expect(await notifications()).toContain('you need to reconnect it');
    expect((await received()).some((r) => r.status === content)).toBe(false);
  } finally {
    await prisma.integration.update({ where: { id: CHANNEL }, data: { refreshNeeded: false } });
    await prisma.$disconnect();
  }
});
