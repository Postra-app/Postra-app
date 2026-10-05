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

const openDraft = async (api: APIRequestContext, channel: string) => {
  const created = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: inDays(2),
      tags: [],
      posts: [{ integration: { id: channel }, value: [{ content: 'first', image: [] }], settings: { __type: 'bluesky' } }],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json())[0].postId as string;
};

test('E2E-05-39: saves opened from the same version at the same moment — one goes through, the rest are a 409', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const channel = org.channelIds[0];
    const postId = await openDraft(org.api, channel);
    const opened = (await (await org.api.get(`/posts/${postId}`)).json()) as {
      group: string;
      posts: { updatedAt: string }[];
    };
    const loadedAt = opened.posts[0].updatedAt;

    // The version check ran before the save's transaction, so every one of
    // these passed it and each replaced the one before without a word.
    const saves = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        save(org.api, channel, opened.group, postId, `editor ${n}`, { expectedUpdatedAt: loadedAt })
      )
    );
    expect(saves.map((s) => s.status()).sort()).toEqual([201, 409, 409, 409]);
  } finally {
    await org.remove();
  }
});

test('E2E-05-40: opening a post whose media is stored by id alone does not turn the first save into a 409', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const channel = org.channelIds[0];
    const postId = await openDraft(org.api, channel);
    const media = await prisma.media.create({
      data: { name: 'stack.png', path: 'https://cdn.example.com/stack.png', organizationId: org.orgId },
    });
    // Rows written before media carried a path: reading the post fills it in.
    await prisma.post.update({ where: { id: postId }, data: { image: JSON.stringify([{ id: media.id }]) } });

    const opened = (await (await org.api.get(`/posts/${postId}`)).json()) as {
      group: string;
      posts: { updatedAt: string; image: { path: string }[] }[];
    };
    expect(opened.posts[0].image[0].path).toBe(media.path);

    // Nobody else saved: the editor's own version must be accepted.
    const saved = await save(org.api, channel, opened.group, postId, 'mine', {
      expectedUpdatedAt: opened.posts[0].updatedAt,
    });
    expect(saved.status(), await saved.text()).toBe(201);
  } finally {
    await org.remove();
  }
});

test('E2E-05-41: a save of two channels refused on one of them leaves the other one as it was', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 2 });
  try {
    const [first, second] = org.channelIds;
    const open = async (id: string) =>
      (await (await org.api.get(`/posts/${id}`)).json()) as {
        group: string;
        posts: { updatedAt: string; content: string }[];
      };

    // A colleague saves the second channel while the two-channel save runs.
    // Each channel used to be its own transaction: the first one committed,
    // the second was refused, and the request answered 409 with half of it
    // saved. A few rounds, since it is a race.
    for (let round = 0; round < 5; round++) {
      const a = await openDraft(org.api, first);
      const b = await openDraft(org.api, second);
      const [openedA, openedB] = [await open(a), await open(b)];
      const loadedAt = [openedA.posts[0].updatedAt, openedB.posts[0].updatedAt].sort().pop();

      const [both, colleague] = await Promise.all([
        org.api.post('/posts', {
          data: {
            type: 'draft',
            shortLink: false,
            date: inDays(2),
            tags: [],
            expectedUpdatedAt: loadedAt,
            posts: [
              { integration: { id: first }, group: openedA.group, value: [{ id: a, content: 'both: one', image: [] }], settings: { __type: 'bluesky' } },
              { integration: { id: second }, group: openedB.group, value: [{ id: b, content: 'both: two', image: [] }], settings: { __type: 'bluesky' } },
            ],
          },
        }),
        save(org.api, second, openedB.group, b, 'colleague', { expectedUpdatedAt: openedB.posts[0].updatedAt }),
      ]);

      expect([both.status(), colleague.status()].sort()).toEqual([201, 409]);
      if (both.status() === 409) {
        expect((await open(a)).posts[0].content).toContain('first');
        expect((await open(a)).posts[0].content).not.toContain('both');
      }
    }
  } finally {
    await org.remove();
  }
});
