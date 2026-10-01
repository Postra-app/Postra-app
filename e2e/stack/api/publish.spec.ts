import { APIRequestContext, expect, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
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
// one after another.
test.describe.configure({ mode: 'serial' });

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
    timeout: 45_000,
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
  await api.post(`${FAKE}/__fail`);
  const content = `[stack] refused ${Date.now()}`;
  const post = await publish(content, 'now', new Date());

  await settledState(post.id).toBe('ERROR');
  const after = await stored(post.id);
  expect(after.releaseURL).toBeFalsy();
  // E2E-05-10: the platform's own reason in one readable sentence — not
  // Temporal's JSON with stack traces and container paths.
  expect(after.error).toContain('Text character limit of 500 exceeded');
  expect(after.error).not.toMatch(/\bat \w+|\/app\/|node_modules|workflowId/);
});
