import { expect, test } from '@playwright/test';
import { channelOf, signedIn } from '../helpers';
import { USERS } from '../seed';

// The calendar's channel filter (upstream 9bf96ebc, 2a2c85c4): the list view
// paginates on the server, so /posts/list filters and counts by channel.

const draft = (channel: string, type: string, content: string) => ({
  type: 'draft',
  shortLink: false,
  date: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  tags: [],
  posts: [{ type: 'draft', integration: { id: channel }, value: [{ content, image: [] }], settings: { __type: type } }],
});

test('the post list keeps only the chosen channels, and counts them', async () => {
  const a = await signedIn('a');
  const tag = `[stack] channel filter ${Date.now()}`;
  const bluesky = channelOf('a');
  const mastodon = USERS.a.mastodon.id;
  const created: string[] = [];
  try {
    for (const [ch, type] of [[bluesky, 'bluesky'], [mastodon, 'mastodon']]) {
      const res = await a.post('/posts', { data: draft(ch, type, `${tag} ${type}`) });
      expect(res.status(), await res.text()).toBe(201);
    }
    const list = async (q: string) => {
      const res = await a.get(`/posts/list?state=draft&limit=100${q}`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      const posts = (body.p ?? body.posts) as { c?: string; content?: string; g?: string; group?: string; n?: { i: string }; integration?: { id: string } }[];
      return { total: body.t ?? body.total, posts };
    };
    const all = await list('');
    for (const p of all.posts.filter((p) => (p.c ?? p.content ?? '').includes(tag))) created.push(p.g ?? p.group!);
    expect(created.length).toBe(2);

    // Other specs add and delete drafts in organisation A at the same time,
    // so every check reads one response and only this test's own posts.
    const mine = (r: Awaited<ReturnType<typeof list>>) =>
      r.posts.map((p) => p.c ?? p.content ?? '').filter((c) => c.includes(tag));
    const onlyBluesky = await list(`&integrations=${bluesky}`);
    expect([...new Set(onlyBluesky.posts.map((p) => p.n?.i ?? p.integration?.id))]).toEqual([bluesky]);
    expect(mine(onlyBluesky)).toEqual([`${tag} bluesky`]);
    expect(onlyBluesky.total).toBe(onlyBluesky.posts.length);

    expect((await list('&integrations=')).total, 'nothing selected → nothing listed').toBe(0);
    expect(mine(await list(`&integrations=${bluesky},${mastodon}`)).sort()).toEqual([`${tag} bluesky`, `${tag} mastodon`]);
    // Another organisation's channel id lists nothing of theirs.
    expect((await list(`&integrations=${channelOf('b')}`)).total).toBe(0);
  } finally {
    for (const g of created) await a.delete(`/posts/${g}`);
    await a.dispose();
  }
});
