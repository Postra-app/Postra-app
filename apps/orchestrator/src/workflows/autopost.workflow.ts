import {
  continueAsNew,
  log,
  patched,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { AutopostActivity } from '@gitroom/orchestrator/activities/autopost.activity';

const { autoPost } = proxyActivities<AutopostActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export async function autoPostWorkflow({
  id,
  immediately,
}: {
  id: string;
  immediately: boolean;
}) {
  let loops = 0;
  while (true) {
    try {
      if (immediately) {
        await autoPost(id);
      }
    } catch (err) {
      // Swallowing keeps the hourly loop alive, but a feed that fails every
      // run would otherwise go dark with no trace.
      log.error('autoPost run failed', { autopostId: id, error: String(err) });
    }
    immediately = true;
    await sleep(3600000);

    // The hourly loop never ended, so its history grew by ~11 events an hour
    // until Temporal's limit (~194 days) terminated the feed for good, and
    // every deploy replayed all of it. A fresh run every day (upstream
    // 185044d5); runs started before this patch hand over on their first
    // live loop.
    if (
      patched('autopost-continue-as-new') &&
      (++loops >= 24 || workflowInfo().historyLength > 1000)
    ) {
      return await continueAsNew<typeof autoPostWorkflow>({
        id,
        immediately: true,
      });
    }
  }
}
