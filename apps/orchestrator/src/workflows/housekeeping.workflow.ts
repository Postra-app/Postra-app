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
  // it (the deploy replays the live run first, scripts/replay-histories.mjs).
  let checkInId: string | undefined;
  if (patched('housekeeping-check-in')) {
    try {
      checkInId = await housekeepingStarted();
    } catch (err) {
      // Reporting is not the work: the day runs unreported and the
      // monitor's missed check-in says so.
    }
  }
  let ok = true;
  try {
    // The media sweep swallows storage errors and counts them: a day on
    // which files could not be removed is not an "ok" day.
    const purged = await purgeOldRecords();
    if ((purged?.failed ?? 0) > 0) ok = false;
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
  if (checkInId) {
    try {
      await housekeepingFinished(checkInId, ok);
    } catch (err) {
      // The monitor's missed check-in says it for us.
    }
  }
  await sleep('1 day');
  await continueAsNew<typeof housekeepingWorkflow>();
}
