import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Business is for agencies: 50 channels shared by the team (was 15, one per
// platform). This is the busiest case the plan allows: one post to every
// channel at once, through Temporal and the real Mastodon provider to
// e2e/stack/fake-mastodon.mjs. It shows the publishing queue takes the whole
// quota in one go, and gives the time it needs.

const FAKE = 'http://localhost:58080';
// pricing.ts ULTIMATE.channel (unit test: pricing.spec.ts).
const CHANNELS = 50;

test.describe.configure({ timeout: 240_000 });

test('a Business workspace publishes one post to all its channels at once', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, {
    tier: 'ULTIMATE',
    totalChannels: CHANNELS,
    channels: CHANNELS,
    provider: 'mastodon',
  });
  try {
    const content = `[stack] business ${CHANNELS} channels ${Date.now()}`;
    const started = Date.now();
    const res = await org.api.post('/posts', {
      data: {
        type: 'now',
        shortLink: false,
        date: new Date().toISOString(),
        tags: [],
        posts: org.channelIds.map((id) => ({
          integration: { id },
          value: [{ content, image: [] }],
          settings: { __type: 'mastodon' },
        })),
      },
    });
    expect(res.status(), await res.text()).toBe(201);

    const states = async () =>
      prisma.post.groupBy({
        by: ['state'],
        where: { organizationId: org.orgId, content: { contains: content }, deletedAt: null },
        _count: { _all: true },
      });
    await expect
      .poll(
        async () =>
          (await states()).find((s) => s.state === 'PUBLISHED')?._count._all ?? 0,
        { timeout: 200_000, intervals: [1_000, 2_000, 5_000] }
      )
      .toBe(CHANNELS);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`${CHANNELS} channels published in ${seconds} s`);

    expect(await states()).toEqual([{ state: 'PUBLISHED', _count: { _all: CHANNELS } }]);
    const received = (await (await org.api.get(`${FAKE}/__received`)).json()) as Array<{
      status: string;
    }>;
    expect(received.filter((r) => r.status === content)).toHaveLength(CHANNELS);
  } finally {
    await prisma.post.deleteMany({ where: { organizationId: org.orgId } });
    await prisma.integration.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
    await prisma.$disconnect();
  }
});
