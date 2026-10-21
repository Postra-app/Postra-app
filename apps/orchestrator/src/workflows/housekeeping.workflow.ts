import { continueAsNew, patched, proxyActivities, sleep } from '@temporalio/workflow';
import type { HousekeepingActivity } from '@gitroom/orchestrator/activities/housekeeping.activity';

const { purgeOldRecords, checkAiMargins } = proxyActivities<HousekeepingActivity>({
  startToCloseTimeout: '30 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '5 minutes',
  },
});

// Reporting to Sentry's cron monitor is quick and must not hold the run:
// one retry, then the day goes on unreported.
const { housekeepingStarted, housekeepingFinished } =
  proxyActivities<HousekeepingActivity>({
    startToCloseTimeout: '1 minute',
    retry: { maximumAttempts: 2, initialInterval: '10 seconds' },
  });

// Started once by the backend when RUN_CRON is set (InfiniteWorkflowRegister),
// like missingPostWorkflow. Once a day: retention for Errors, AuditLog and
// AiUsage, stored files behind media deleted long enough ago that nothing
// refers to, and the margin guard (AI cost per organisation vs its plan).
// A failed day is tried again the next day; one failing does not skip the
// other.
export async function housekeepingWorkflow() {
  // A run is alive at every deploy and replays this code against its own
  // history, so every new step goes behind a patch: the run started before
  // the step shipped skips it, sleeps out its day and continues as new with
  // it (E2E-11-15; housekeeping.workflow.replay.spec.ts).
  const reported = patched('housekeeping-check-in');
  const checkInId = reported ? await housekeepingStarted() : undefined;
  let ok = true;
  try {
    await purgeOldRecords();
  } catch (err) {
    // Next run tomorrow.
    ok = false;
  }
  if (patched('housekeeping-margin-guard')) {
    try {
      await checkAiMargins();
    } catch (err) {
      // Next run tomorrow.
      ok = false;
    }
  }
  if (reported) {
    try {
      await housekeepingFinished(checkInId as string, ok);
    } catch (err) {
      // The monitor's missed check-in says it for us.
    }
  }
  await sleep('1 day');
  await continueAsNew<typeof housekeepingWorkflow>();
}
