import { APIRequestContext, expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Two people editing one post (an agency): the second save replaced the
// first without a word. A save carrying the time the editor loaded the post
// is refused with 409 when someone saved after that; without it (API, agent)
// the last save still wins.

const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const save = (api: APIRequestContext, channel: string, group: string, id: string, content: string, extra = {}) =>
  api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: inDays(2),
      tags: [],
      posts: [
        {
          integration: { id: channel },
          group,
          value: [{ id, content, image: [] }],
          settings: { __type: 'bluesky' },
        },
      ],
      ...extra,
    },
  });

test('a save over a newer change is a 409; with the newer time, or without one, it goes through', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const channel = org.channelIds[0];
    const created = await org.api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: inDays(2),
        tags: [],
        posts: [{ integration: { id: channel }, value: [{ content: 'first', image: [] }], settings: { __type: 'bluesky' } }],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { postId } = (await created.json())[0];
    const opened = (await (await org.api.get(`/posts/${postId}`)).json()) as {
      group: string;
      posts: { id: string; updatedAt: string; content: string }[];
    };
    const loadedAt = opened.posts[0].updatedAt;

    // A colleague saves in the meantime.
    expect((await save(org.api, channel, opened.group, postId, 'theirs')).status()).toBe(201);

    const refused = await save(org.api, channel, opened.group, postId, 'mine', { expectedUpdatedAt: loadedAt });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).message).toContain('after you opened it');
    expect((await (await org.api.get(`/posts/${postId}`)).json()).posts[0].content).toContain('theirs');

    const current = (await (await org.api.get(`/posts/${postId}`)).json()).posts[0].updatedAt;
    expect((await save(org.api, channel, opened.group, postId, 'mine, on theirs', { expectedUpdatedAt: current })).status()).toBe(201);
    expect((await save(org.api, channel, opened.group, postId, 'no time sent')).status()).toBe(201);
    expect((await (await org.api.get(`/posts/${postId}`)).json()).posts[0].content).toContain('no time sent');
  } finally {
    await org.remove();
  }
});
