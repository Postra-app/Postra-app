import { APIRequestContext, expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

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
