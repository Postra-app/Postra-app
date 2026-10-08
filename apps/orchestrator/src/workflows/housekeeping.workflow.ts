import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { HousekeepingActivity } from '@gitroom/orchestrator/activities/housekeeping.activity';

const { purgeOldRecords, checkAiMargins } = proxyActivities<HousekeepingActivity>({
  startToCloseTimeout: '30 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '5 minutes',
  },
});

// Started once by the backend when RUN_CRON is set (InfiniteWorkflowRegister),
// like missingPostWorkflow. Once a day: retention for Errors, AuditLog and
// AiUsage, stored files behind media deleted long enough ago that nothing
// refers to, and the margin guard (AI cost per organisation vs its plan).
// A failed day is tried again the next day; one failing does not skip the
// other.
export async function housekeepingWorkflow() {
  try {
    await purgeOldRecords();
  } catch (err) {
    // Next run tomorrow.
  }
  try {
    await checkAiMargins();
  } catch (err) {
    // Next run tomorrow.
  }
  await sleep('1 day');
  await continueAsNew<typeof housekeepingWorkflow>();
}
