import { APIRequestContext, expect, test } from '@playwright/test';
import { database, listPosts, signedIn, throwawayOrg } from '../helpers';
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

// The public API and the agent may send `<p class="…">`: it used to be taken
// for plain text and reach the platform with its tags (upstream 53ea9c8f).
test('paragraphs with attributes reach the platform as lines of text', async () => {
  const tag = Date.now();
  const res = await api.post('/posts', {
    data: {
      type: 'now',
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: CHANNEL },
          value: [{ content: `<p class="lead" dir="auto">[stack] first line ${tag}</p><p class="body" dir="auto">second line</p>`, image: [] }],
          settings: { __type: 'mastodon' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const post = (await listPosts(api)).find((p) => p.content.includes(`first line ${tag}`))!;
  // The editor writes dir="auto" for right-to-left text (upstream 1d4b75fa,
  // 75cb2f83); the sanitizer used to drop it.
  expect(post.content).toContain('dir="auto"');
  await settledState(post.id).toBe('PUBLISHED');
  const sent = (await received()).find((r) => r.status.includes(`first line ${tag}`));
  expect(sent?.status).not.toMatch(/<\/?p/);
  expect(sent?.status.split('\n').map((l) => l.trim())).toEqual([`[stack] first line ${tag}`, 'second line']);
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

  // The calendar tooltip and the public API read the list, which never
  // selected the error and showed "An error occurred" (upstream 291b07b4).
  const window = `startDate=${new Date(Date.now() - 86_400_000).toISOString()}&endDate=${new Date(Date.now() + 86_400_000).toISOString()}`;
  const calendar: { p: { i: string; error: string | null }[] } = await (await api.get(`/posts?${window}`)).json();
  const tile = calendar.p.find((p) => p.i === post.id);
  expect(tile?.error).toContain('Text character limit of 500 exceeded');
  expect(tile?.error).not.toMatch(/\bat \w+|\/app\/|node_modules|workflowId/);
  const pub = await api.get(`/public/v1/posts?${window}`, { headers: { Authorization: USERS.a.apiKey } });
  expect(pub.status()).toBe(200);
  const listed = (await pub.json()).posts.find((p: { id: string }) => p.id === post.id);
  expect(listed?.error).toContain('Text character limit of 500 exceeded');
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
// nothing reaches the platform. Each runs in its own organisation: disabling
// A's Mastodon hid it from the UI tests running beside this file.
const badChannelPost = async (
  breakIt: (prisma: ReturnType<typeof database>, channelId: string, owner: APIRequestContext) => Promise<void>
) => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1, provider: 'mastodon' });
  const content = `[stack] bad channel ${Date.now()}`;
  const res = await org.api.post('/posts', {
    data: {
      type: 'schedule',
      shortLink: false,
      date: new Date(Date.now() + 12_000).toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: org.channelIds[0] },
          value: [{ content, image: [] }],
          settings: { __type: 'mastodon' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const post = (await listPosts(org.api)).find((p) => p.content.includes(content))!;
  await breakIt(prisma, org.channelIds[0], org.api);
  return {
    content,
    state: () =>
      expect.poll(async () => (await (await org.api.get(`/posts/${post.id}`)).json()).posts[0].state, {
        timeout: 90_000,
        intervals: [500, 1_000, 2_000],
      }),
    error: async () => (await (await org.api.get(`/posts/${post.id}`)).json()).posts[0].error,
    notifications: async () => JSON.stringify(await (await org.api.get('/notifications/list')).json()),
    done: async () => {
      await org.remove();
      await prisma.$disconnect();
    },
  };
};

test('a channel disabled before publish time: the post fails as "Channel disabled"', async () => {
  const run = await badChannelPost(async (_prisma, id, owner) => {
    expect((await owner.post('/integrations/disable', { data: { id } })).status()).toBe(201);
  });
  try {
    await run.state().toBe('ERROR');
    expect(await run.error()).toBe('Channel disabled');
    expect(await run.notifications()).toContain("because it's disabled");
    expect((await received()).some((r) => r.status === run.content)).toBe(false);
  } finally {
    await run.done();
  }
});

test('a channel that needs reconnecting: the post fails as "Refresh channel needed"', async () => {
  const run = await badChannelPost(async (prisma, id) => {
    await prisma.integration.update({ where: { id }, data: { refreshNeeded: true } });
  });
  try {
    await run.state().toBe('ERROR');
    expect(await run.error()).toBe('Refresh channel needed');
    expect(await run.notifications()).toContain('you need to reconnect it');
    expect((await received()).some((r) => r.status === run.content)).toBe(false);
  } finally {
    await run.done();
  }
});

// §5.4 "comment failure": the post goes out, the platform refuses the reply.
// The post stays published, only the reply is flagged, and the team is told
// which part did not make it.
test('a refused reply leaves the post published and flags only the reply', async () => {
  const tag = Date.now();
  const main = `[stack] main part ${tag}`;
  const reply = `[stack] refused reply ${tag}`;
  expect((await api.post(`${FAKE}/__fail`, { data: { match: reply } })).ok()).toBe(true);
  const res = await api.post('/posts', {
    data: {
      type: 'now',
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: CHANNEL },
          value: [
            { content: main, image: [] },
            { content: reply, image: [] },
          ],
          settings: { __type: 'mastodon' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const post = (await listPosts(api)).find((p) => p.content.includes(main))!;

  await settledState(post.id).toBe('PUBLISHED');
  const { posts } = await (await api.get(`/posts/${post.id}`)).json();
  const replyRow = posts.find((p: { content: string }) => p.content.includes(reply));
  await expect
    .poll(async () => ((await (await api.get(`/posts/${post.id}`)).json()).posts as { id: string; state: string }[]).find((p) => p.id === replyRow.id)?.state, { timeout: 30_000 })
    .toBe('ERROR');
  expect((await received()).some((r) => r.status === main)).toBe(true);
  const notices = JSON.stringify(await (await api.get('/notifications/list')).json());
  expect(notices).toContain('one of the comments attached to it could not be posted');
});
