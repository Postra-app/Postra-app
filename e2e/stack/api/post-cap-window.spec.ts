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

const fill = async (orgId: string, channel: string, n: number, at: Date, state: 'QUEUE' | 'DRAFT' | 'ERROR') => {
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

test('Codex: a bad date is a 400, a query cannot pass as the public API, a draft moves freely', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    const full = await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    // An invalid date looped forever in the month window and froze the backend.
    const bad = await org.api.put(`/posts/${full[0].id}/date`, { data: { date: 'invalid', action: 'update' }, timeout: 5_000 });
    expect(bad.status()).toBe(400);

    const sneaky = await org.api.post('/posts?x=/public/v1/', {
      data: {
        type: 'schedule',
        shortLink: false,
        date: inDays(41).toISOString(),
        tags: [],
        posts: [{ integration: { id: channel }, date: inDays(2).toISOString(), value: [{ content: 'x', image: [] }], settings: { __type: 'facebook' } }],
      },
    });
    expect(sneaky.status(), await sneaky.text()).toBe(402);

    // The calendar drags a draft with action "schedule"; it stays a draft.
    const [draft] = await fill(org.orgId, channel, 1, inDays(42), 'DRAFT');
    expect((await org.api.put(`/posts/${draft.id}/date`, { data: { date: inDays(3).toISOString(), action: 'schedule' } })).status()).toBe(200);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

test('Codex: a failed post moves freely, and a far-out date answers', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    const full = await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    const [failed] = await fill(org.orgId, channel, 1, inDays(41), 'QUEUE');
    await prisma.post.update({ where: { id: failed.id }, data: { state: 'ERROR' } });
    expect((await org.api.put(`/posts/${failed.id}/date`, { data: { date: inDays(3).toISOString(), action: 'update' } })).status()).toBe(200);
    // Beyond JavaScript's date range one month on: the backend answers.
    const far = await org.api.put(`/posts/${full[0].id}/date`, { data: { date: '+275760-09-13T00:00:00.000Z', action: 'update' }, timeout: 5_000 });
    expect(far.status()).toBeLessThan(500);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

// Codex: a save of type 'update' keeps each post's state, so editing drafts
// or failed posts adds nothing to the month; it was refused at a full month.
test('editing drafts and failed posts with "update" goes through at a full month', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    const kept = [
      ...(await fill(org.orgId, channel, 1, inDays(2), 'DRAFT')),
      ...(await fill(org.orgId, channel, 1, inDays(2), 'ERROR')),
    ];
    const res = await org.api.post('/posts', {
      data: {
        type: 'update',
        shortLink: false,
        date: inDays(2).toISOString(),
        tags: [],
        posts: kept.map((p) => ({
          integration: { id: channel },
          group: p.group,
          value: [{ id: p.id, content: 'edited', image: [] }],
          settings: { __type: 'facebook' },
        })),
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const rows = await prisma.post.findMany({ where: { id: { in: kept.map((p) => p.id) } } });
    expect(rows.map((r) => [r.state, r.content]).sort()).toEqual([
      ['DRAFT', expect.stringContaining('edited')],
      ['ERROR', expect.stringContaining('edited')],
    ]);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

// Codex: the guard counted outside any lock, so saves or moves sent at once
// with one post left in the month all went through.
const countIn = (orgId: string, from: Date, to: Date) =>
  prisma.post.count({ where: { organizationId: orgId, deletedAt: null, state: 'QUEUE', publishDate: { gte: from, lt: to } } });

test('saves sent at once with one post left: only one goes through', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    await fill(org.orgId, channel, LIMIT - 1, inDays(1), 'QUEUE');
    const statuses = (
      await Promise.all(Array.from({ length: 4 }, (_, i) => schedule(org.api, channel, inDays(2), [{ content: `at once ${i}` }])))
    ).map((r) => r.status());
    expect(statuses.sort()).toEqual([201, 402, 402, 402]);
    expect(await countIn(org.orgId, inDays(0), inDays(30))).toBe(LIMIT);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

test('posts moved at once into a month with one post left: only one moves', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    await fill(org.orgId, channel, LIMIT - 1, inDays(1), 'QUEUE');
    const later = await fill(org.orgId, channel, 4, inDays(41), 'QUEUE');
    const statuses = (
      await Promise.all(
        later.map((p) => org.api.put(`/posts/${p.id}/date`, { data: { date: inDays(2).toISOString(), action: 'update' } }))
      )
    ).map((r) => r.status());
    expect(statuses.sort()).toEqual([200, 402, 402, 402]);
    expect(await countIn(org.orgId, inDays(0), inDays(30))).toBe(LIMIT);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

// Codex: a save at a full month that takes one post out of the count (kept as
// a draft, or moved to another month) and puts another in leaves the month as
// full as it was; it was refused.
const saveAs = (api: APIRequestContext, channel: string, posts: { id: string; group: string; type: string; date: Date }[]) =>
  api.post('/posts', {
    data: {
      type: 'schedule',
      shortLink: false,
      date: inDays(2).toISOString(),
      tags: [],
      posts: posts.map((p) => ({
        integration: { id: channel },
        group: p.group,
        type: p.type,
        date: p.date.toISOString(),
        value: [{ id: p.id, content: `swapped ${p.type}`, image: [] }],
        settings: { __type: 'facebook' },
      })),
    },
  });

test('a save at a full month that swaps one post for another goes through', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    const queued = await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    const [draft] = await fill(org.orgId, channel, 1, inDays(2), 'DRAFT');
    const res = await saveAs(org.api, channel, [
      { id: queued[0].id, group: queued[0].group, type: 'draft', date: inDays(1) },
      { id: draft.id, group: draft.group, type: 'schedule', date: inDays(2) },
    ]);
    expect(res.status(), await res.text()).toBe(201);
    expect(await countIn(org.orgId, inDays(0), inDays(30))).toBe(LIMIT);
    // Still nothing to spare: one more is refused.
    const more = await schedule(org.api, channel, inDays(2), [{ content: 'one more' }]);
    expect(more.status(), await more.text()).toBe(402);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});

test('two full months can swap a post each in one save', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 1, provider: 'facebook' });
  const channel = org.channelIds[0];
  try {
    const [a] = await fill(org.orgId, channel, LIMIT, inDays(1), 'QUEUE');
    const [b] = await fill(org.orgId, channel, LIMIT, inDays(41), 'QUEUE');
    const res = await saveAs(org.api, channel, [
      { id: a.id, group: a.group, type: 'schedule', date: inDays(42) },
      { id: b.id, group: b.group, type: 'schedule', date: inDays(2) },
    ]);
    expect(res.status(), await res.text()).toBe(201);
    expect(await countIn(org.orgId, inDays(0), inDays(30))).toBe(LIMIT);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
  }
});
