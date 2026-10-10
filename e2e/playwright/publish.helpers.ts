import { APIRequestContext, expect } from '@playwright/test';

// Shared by the nightly publishing canary and the manual per-provider matrix
// (matrix.technical.spec.ts). Real publishing on the technical channels only.

export const TECHNICAL = ['telegram', 'discord', 'mastodon', 'bluesky'];
export const stamp = `${new Date().toISOString().slice(0, 16)}Z ${
  process.env.GITHUB_SHA?.slice(0, 7) || 'local'
}`;

// These posts are public, so they read as Postra ads (Krzysztof, 2026-10-01).
// One line per weekday; the stamp at the end keeps every night's post unique
// so the test can find it.
export const PROMO = [
  'Plan a whole month of posts in one afternoon. Write once, publish to every channel - postra.co.uk',
  'Your calendar, your channels, one place. Schedule posts everywhere with Postra - postra.co.uk',
  'Stop copy-pasting the same post into five apps. Postra publishes it everywhere for you - postra.co.uk',
  'AI that writes in your brand voice, a calendar your whole team shares. Meet Postra - postra.co.uk',
  'From idea to published post on every channel in minutes. Try Postra - postra.co.uk',
  'Agencies: every client, every channel, one calendar. Postra - postra.co.uk',
  'Write it once, Postra adapts it for each platform and posts it on time - postra.co.uk',
];
export const promo = (n = 0) => `${PROMO[(new Date().getUTCDay() + n) % PROMO.length]} · ${stamp}`;

export type Channel = { id: string; identifier: string; name: string; display?: string };
export type Stored = { id: string; state: string; releaseURL: string | null; error: string | null };

export const channels = async (api: APIRequestContext): Promise<Channel[]> => {
  const res = await api.get('/api/integrations/list');
  expect(res.status()).toBe(200);
  const all: (Channel & { disabled: boolean })[] = (await res.json()).integrations;
  return all.filter((c) => TECHNICAL.includes(c.identifier) && !c.disabled);
};

// What the composer sends for each platform; Discord needs one of the
// server's channels, fetched the way the composer fetches it.
export const settingsFor = async (api: APIRequestContext, channel: Channel) => {
  if (channel.identifier !== 'discord') return { __type: channel.identifier };
  const res = await api.post('/api/integrations/function', {
    data: { id: channel.id, name: 'channels' },
  });
  expect(res.ok(), 'Discord channel list').toBeTruthy();
  const [first]: { id: string }[] = await res.json();
  expect(first, 'a Discord channel to post in').toBeTruthy();
  return { __type: 'discord', channel: first.id };
};

export type Media = { id: string; path: string };

export const publish = async (
  api: APIRequestContext,
  targets: Channel[],
  content: string,
  type: 'now' | 'schedule',
  date: Date,
  image: Media[] = []
) => {
  const posts = [];
  for (const channel of targets) {
    posts.push({
      integration: { id: channel.id },
      value: [{ content, image }],
      settings: await settingsFor(api, channel),
    });
  }
  const res = await api.post('/api/posts', {
    data: { type, shortLink: false, date: date.toISOString(), tags: [], posts },
  });
  expect(res.status(), await res.text()).toBe(201);
};

// The calendar's minified list: { p: [{ i: id, c: content, g: group, ... }] }.
export const findPosts = async (api: APIRequestContext, content: string) => {
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const res = await api.get(`/api/posts?startDate=${from}&endDate=${to}`);
  expect(res.status()).toBe(200);
  const body: { p: { i: string; c: string }[] } = await res.json();
  return body.p.filter((p) => p.c?.includes(content)).map((p) => p.i);
};

export const stored = async (api: APIRequestContext, id: string): Promise<Stored> =>
  (await (await api.get(`/api/posts/${id}`)).json()).posts[0];

export const waitPublished = async (api: APIRequestContext, ids: string[], timeout: number) => {
  await expect
    .poll(
      async () => {
        const states = await Promise.all(ids.map(async (id) => (await stored(api, id)).state));
        if (states.includes('ERROR')) {
          const failed = await Promise.all(ids.map((id) => stored(api, id)));
          throw new Error(
            `publishing failed: ${failed
              .filter((p) => p.state === 'ERROR')
              .map((p) => p.error)
              .join(' | ')}`
          );
        }
        return states.every((s) => s === 'PUBLISHED');
      },
      { timeout, intervals: [2_000, 5_000] }
    )
    .toBe(true);
  return Promise.all(ids.map((id) => stored(api, id)));
};

// Read the post back from the platform, without Postra in between.
export const onPlatform = async (api: APIRequestContext, releaseURL: string, content: string) => {
  const url = new URL(releaseURL);
  if (url.hostname === 'bsky.app') {
    // The provider writes the account's DID where bsky.app expects a handle.
    const [, , actor, , rkey] = url.pathname.split('/');
    const did = actor.startsWith('did:')
      ? actor
      : (
          await (
            await api.get(
              `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${actor}`
            )
          ).json()
        ).did;
    const thread = await api.get(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at://${did}/app.bsky.feed.post/${rkey}`
    );
    expect(thread.status(), 'Bluesky has the post').toBe(200);
    expect((await thread.json()).thread.post.record.text).toContain(content);
    return 'read back from Bluesky';
  }
  if (url.pathname.startsWith('/statuses/')) {
    const id = url.pathname.split('/').pop();
    const status = await api.get(`${url.origin}/api/v1/statuses/${id}`);
    expect(status.status(), 'Mastodon has the post').toBe(200);
    // Mastodon returns HTML and turns postra.co.uk into a link.
    // Strip until nothing changes: one pass can leave a tag behind (CodeQL #72).
    let text = String((await status.json()).content);
    for (let prev = ''; prev !== text; ) {
      prev = text;
      text = text.replace(/<[^>]*>/g, '');
    }
    expect(text).toContain(content);
    return 'read back from Mastodon';
  }
  // Telegram's channel has no public web preview and Discord has no
  // unauthenticated read API: the evidence is the message id the platform
  // itself returned.
  expect(url.pathname.split('/').pop(), `message id in ${releaseURL}`).toMatch(/^\d+$/);
  return 'message id returned by the platform';
};

// A post with its own value list: the first entry is the post, the rest are
// its comments or thread replies, as the composer sends them.
export type Value = { content: string; image?: (Media & { alt?: string })[] };

export const publishValues = async (
  api: APIRequestContext,
  targets: Channel[],
  values: Value[],
  type: 'now' | 'schedule' = 'now',
  date: Date = new Date()
) => {
  const posts = [];
  for (const channel of targets) {
    posts.push({
      integration: { id: channel.id },
      value: values.map((v) => ({ content: v.content, image: v.image || [] })),
      settings: await settingsFor(api, channel),
    });
  }
  const res = await api.post('/api/posts', {
    data: { type, shortLink: false, date: date.toISOString(), tags: [], posts },
  });
  expect(res.status(), await res.text()).toBe(201);
};
