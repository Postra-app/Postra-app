import { APIRequestContext, expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// E2E-07-34: two ways past Starter's 400 posts a month. Scheduling drafts
// that already exist counted as an edit (adding = 0), so at 399 one request
// scheduled any number of them; and the count had no end date, so posts
// scheduled for next month ate this month's allowance.

const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

const LIMIT = 400;
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

const fill = async (orgId: string, channel: string, n: number, at: Date, state: 'QUEUE' | 'DRAFT') => {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `cap-${orgId}-${state}-${+at}-${i}`,
    organizationId: orgId,
    integrationId: channel,
    content: `cap ${i}`,
    group: `cap-${orgId}-${state}-${+at}-${i}`,
    publishDate: at,
    state,
  }));
  await prisma.post.createMany({ data: rows });
  return rows;
};

const schedule = (api: APIRequestContext, channel: string, date: Date, values: { id?: string; content: string }[]) =>
  api.post('/posts', {
    data: {
      type: 'schedule',
      shortLink: false,
      date: date.toISOString(),
      tags: [],
      posts: values.map((v) => ({
        integration: { id: channel },
        ...(v.id ? { group: `cap-g-${v.id}` } : {}),
        value: [{ ...v, image: [] }],
        settings: { __type: 'bluesky' },
      })),
    },
  });

test('scheduling existing drafts counts against the month', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    await fill(org.orgId, channel, LIMIT - 1, inDays(1), 'QUEUE');
    const drafts = await fill(org.orgId, channel, 2, inDays(2), 'DRAFT');
    const res = await schedule(
      org.api,
      channel,
      inDays(2),
      drafts.map((d) => ({ id: d.id, content: 'scheduled' }))
    );
    expect(res.status(), await res.text()).toBe(402);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

test("posts for next month count against next month, not this one", async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    // The subscription starts now, so +40 days is the next billing month.
    await fill(org.orgId, channel, LIMIT, inDays(40), 'QUEUE');
    const thisMonth = await schedule(org.api, channel, inDays(2), [{ content: 'this month' }]);
    expect(thisMonth.status(), await thisMonth.text()).toBe(201);
    const nextMonth = await schedule(org.api, channel, inDays(41), [{ content: 'next month' }]);
    expect(nextMonth.status(), await nextMonth.text()).toBe(402);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

// Codex on E2E-07-34: the public API drops a per-channel date and saves on
// the request date, so the check has to count there too; and a draft
// scheduled through PUT /posts/:id/status counts against its own month.
test('the public API counts a post where it saves it', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const api = await pwRequest.newContext({ baseURL: `${BACKEND_URL}/public/v1/`, extraHTTPHeaders: { authorization: apiKey! } });
  try {
    await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    const res = await api.post('posts', {
      data: {
        type: 'schedule',
        shortLink: false,
        date: inDays(2).toISOString(),
        tags: [],
        posts: [{ integration: { id: channel }, date: inDays(41).toISOString(), value: [{ content: 'x', image: [] }], settings: { __type: 'facebook' } }],
      },
    });
    expect(res.status(), await res.text()).toBe(402);
    expect((await api.post('posts', { data: { type: 'draft', date: inDays(2).toISOString(), tags: [], shortLink: false, posts: [null] } })).status()).toBe(400);
  } finally {
    await api.dispose();
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

test("scheduling a draft counts against the draft's month", async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const api = await pwRequest.newContext({ baseURL: `${BACKEND_URL}/public/v1/`, extraHTTPHeaders: { authorization: apiKey! } });
  try {
    // This month full, next month empty: a draft for next month goes through.
    await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    const [nextDraft] = await fill(org.orgId, channel, 1, inDays(41), 'DRAFT');
    const ok = await api.put(`posts/${nextDraft.id}/status`, { data: { status: 'schedule' } });
    expect(ok.status(), await ok.text()).toBe(200);
    // Next month full too: another draft for it is refused.
    await fill(org.orgId, channel, LIMIT, inDays(42), 'QUEUE');
    const [another] = await fill(org.orgId, channel, 1, inDays(43), 'DRAFT');
    expect((await api.put(`posts/${another.id}/status`, { data: { status: 'schedule' } })).status()).toBe(402);
  } finally {
    await api.dispose();
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

test('a scheduled post can still be edited when its month is full', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    const rows = await fill(org.orgId, channel, LIMIT, inDays(2), 'QUEUE');
    const res = await schedule(org.api, channel, inDays(2), [{ id: rows[0].id, content: 'edited' }]);
    expect(res.status(), await res.text()).toBe(201);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

test('"Post now" on a post scheduled for next month counts against this month', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    const [later] = await fill(org.orgId, channel, 1, inDays(41), 'QUEUE');
    const res = await org.api.post('/posts', {
      data: {
        type: 'now',
        shortLink: false,
        date: new Date().toISOString(),
        tags: [],
        posts: [{ integration: { id: channel }, group: `cap-g-${later.id}`, value: [{ id: later.id, content: 'now', image: [] }], settings: { __type: 'facebook' } }],
      },
    });
    expect(res.status(), await res.text()).toBe(402);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

test('moving a scheduled post into a full month is refused, within it is fine', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    const full = await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    const [later] = await fill(org.orgId, channel, 1, inDays(41), 'QUEUE');
    const move = (id: string, date: Date) => org.api.put(`/posts/${id}/date`, { data: { date: date.toISOString(), action: 'update' } });
    expect((await move(later.id, inDays(3))).status()).toBe(402);
    expect((await move(full[0].id, inDays(4))).status()).toBe(200);
    // A draft moves freely: it does not count.
    const [draft] = await fill(org.orgId, channel, 1, inDays(42), 'DRAFT');
    expect((await move(draft.id, inDays(3))).status()).toBe(200);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});
