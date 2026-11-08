import { expect, test } from '@playwright/test';
import { Connection, Client } from '@temporalio/client';
import { database, throwawayOrg } from '../helpers';

// The scheduled token refresh, through the real Temporal and the real
// worker: `refreshTokenWorkflow` sleeps until the stored expiry and calls the
// `refreshToken` activity. That activity was once missing from the worker
// (no decorator), so every renewal failed before a token expired and nothing
// showed it until the token died. Bluesky answers a refresh with no token,
// so the run must end with the channel marked for reconnecting — the
// activity ran, completed, and the result reached the database.
test.describe.configure({ timeout: 90_000 });

test('the scheduled refresh wakes at the stored expiry and its activity runs in the worker', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS || 'localhost:57233' });
  const temporal = new Client({ connection, namespace: 'default' });
  const [channelId] = org.channelIds;
  try {
    await prisma.integration.update({
      where: { id: channelId },
      data: { tokenExpiration: new Date(Date.now() + 3_000), refreshToken: 'stack-refresh-token' },
    });

    const handle = await temporal.workflow.start('refreshTokenWorkflow', {
      workflowId: `refresh_${channelId}`,
      taskQueue: 'main',
      args: [{ integrationId: channelId, organizationId: org.orgId }],
      workflowIdConflictPolicy: 'TERMINATE_EXISTING',
    });
    expect(await handle.result()).toBe(false);

    const history = await handle.fetchHistory();
    const activities = (history.events ?? [])
      .filter((e) => e.activityTaskScheduledEventAttributes)
      .map((e) => e.activityTaskScheduledEventAttributes!.activityType!.name);
    expect(activities).toContain('refreshToken');
    const failed = (history.events ?? []).filter((e) => e.activityTaskFailedEventAttributes);
    expect(failed, 'no activity failed (an unregistered one fails every attempt)').toHaveLength(0);
    expect((history.events ?? []).some((e) => e.timerStartedEventAttributes), 'slept until the expiry').toBe(true);

    const channel = await prisma.integration.findUniqueOrThrow({ where: { id: channelId } });
    expect(channel.refreshNeeded, 'a refresh with no token asks for a reconnect').toBe(true);
  } finally {
    await connection.close();
    await org.remove();
    await prisma.$disconnect();
  }
});
