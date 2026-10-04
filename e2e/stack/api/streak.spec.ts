import { expect, test } from '@playwright/test';
import { Client, Connection } from '@temporalio/client';
import { database, throwawayOrg } from '../helpers';

// Streak V2, read from Temporal itself: the first published post starts one
// streak run for the organization, and the next post leaves that same run
// alone (V1 terminated and restarted it on every publish).
test.describe.configure({ timeout: 150_000 });

test('a second published post keeps the same streak run', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 1, provider: 'mastodon' });
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS || 'localhost:57233' });
  const temporal = new Client({ connection, namespace: 'default' });
  const streak = () => temporal.workflow.getHandle(`streak_${org.orgId}`).describe();
  const publish = async (content: string) => {
    const res = await org.api.post('/posts', {
      data: {
        type: 'now',
        shortLink: false,
        date: new Date().toISOString(),
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
  };
  try {
    await publish(`[stack] streak one ${Date.now()}`);
    await expect
      .poll(async () => (await streak().catch(() => null))?.status.name, { timeout: 90_000, intervals: [1_000, 2_000] })
      .toBe('RUNNING');
    const first = await streak();
    expect(first.type).toBe('streakWorkflowV2');
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).streakSince).not.toBeNull();

    await publish(`[stack] streak two ${Date.now()}`);
    await expect
      .poll(async () => (await prisma.post.count({ where: { organizationId: org.orgId, state: 'PUBLISHED' } })), {
        timeout: 90_000,
        intervals: [1_000, 2_000],
      })
      .toBe(2);
    const second = await streak();
    expect(second.runId).toBe(first.runId);
    expect(second.status.name).toBe('RUNNING');
  } finally {
    await temporal.workflow.getHandle(`streak_${org.orgId}`).terminate('test done').catch(() => undefined);
    await connection.close();
    await org.remove();
    await prisma.$disconnect();
  }
});
