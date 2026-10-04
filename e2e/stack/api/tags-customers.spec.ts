import { APIRequestContext, expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Two calendar filters that let removed things back in (upstream 81547fc6,
// 8d81cacd), each on an organisation of its own:
// - a deleted tag stayed on its posts, and a new tag of the same name
//   attached the deleted one as well;
// - filtering the calendar by customer replaced the "channel not deleted"
//   condition, so the customer's view listed posts of deleted channels.

const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const draft = async (api: APIRequestContext, channel: string, content: string, tag?: string) => {
  const res = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: inDays(2),
      tags: tag ? [{ value: tag, label: tag }] : [],
      posts: [
        {
          integration: { id: channel },
          value: [{ content, image: [] }],
          settings: { __type: 'bluesky' },
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { postId } = (await res.json())[0];
  return postId as string;
};

const tagsOf = async (api: APIRequestContext, postId: string) => {
  const post = (await (await api.get(`/posts/${postId}`)).json()).posts[0];
  return (post.tags ?? []).map((t: { tag: { id: string; name: string } }) => t.tag);
};

test('a deleted tag leaves its posts, and a new tag of the same name is the only one attached', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const name = `Promo ${Date.now()}`;
    const first = await (await org.api.post('/posts/tags', { data: { name, color: '#38bdf8' } })).json();
    const tagged = await draft(org.api, org.channelIds[0], 'tagged post', name);
    expect((await tagsOf(org.api, tagged)).map((t: { id: string }) => t.id)).toEqual([first.id]);

    expect((await org.api.delete(`/posts/tags/${first.id}`)).status()).toBe(200);
    expect(await tagsOf(org.api, tagged)).toEqual([]);

    const second = await (await org.api.post('/posts/tags', { data: { name, color: '#a78bfa' } })).json();
    const again = await draft(org.api, org.channelIds[0], 'tagged again', name);
    expect((await tagsOf(org.api, again)).map((t: { id: string }) => t.id)).toEqual([second.id]);
  } finally {
    await org.remove();
  }
});

test("a customer's calendar does not list posts of a deleted channel", async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 2 });
  try {
    const [gone, kept] = org.channelIds;
    for (const id of [gone, kept]) {
      const res = await org.api.put(`/integrations/${id}/customer-name`, { data: { name: 'Client X' } });
      expect(res.status(), await res.text()).toBe(200);
    }
    const customer = (await (await org.api.get('/integrations/customers')).json()).find(
      (c: { name: string }) => c.name === 'Client X'
    );
    expect(customer).toBeTruthy();

    await draft(org.api, gone, 'post of a channel about to go');
    await draft(org.api, kept, 'post of a channel that stays');
    // Deleted outside the delete route, which would also delete its posts:
    // the filter itself must hold.
    await prisma.integration.update({ where: { id: gone }, data: { deletedAt: new Date() } });

    const res = await org.api.get(
      `/posts?startDate=${inDays(-7)}&endDate=${inDays(30)}&customer=${customer.id}`
    );
    expect(res.status()).toBe(200);
    const contents = ((await res.json()).p as { c: string }[]).map((p) => p.c);
    expect(contents.some((c) => c.includes('stays'))).toBe(true);
    expect(contents.some((c) => c.includes('about to go'))).toBe(false);
  } finally {
    await org.remove();
  }
});
