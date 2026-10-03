import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { HousekeepingActivity } from '@gitroom/orchestrator/activities/housekeeping.activity';

const { purgeOldRecords } = proxyActivities<HousekeepingActivity>({
  startToCloseTimeout: '30 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '5 minutes',
  },
});

// Started once by the backend when RUN_CRON is set (InfiniteWorkflowRegister),
// like missingPostWorkflow. Once a day: retention for Errors, AuditLog and
// AiUsage, and stored files behind media deleted long enough ago that
// nothing refers to. A failed day is tried again the next day.
export async function housekeepingWorkflow() {
  try {
    await purgeOldRecords();
  } catch (err) {
    // Next run tomorrow.
  }
  await sleep('1 day');
  await continueAsNew<typeof housekeepingWorkflow>();
}
