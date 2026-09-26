import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';

const { searchForMissingThreeHoursPosts } = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

// Hours per run before handing over to a fresh execution, so the history
// stays small instead of growing for as long as the backend lives.
const HOURS_PER_RUN = 24;

// Started once by the backend when RUN_CRON is set (InfiniteWorkflowRegister).
// It is the only thing that re-pokes a post left in QUEUE past its time, so it
// must not die: a failed search (a database blip after the three retries) used
// to fail the whole workflow, and nothing restarted it until the next deploy
// (E2E-05-24).
export async function missingPostWorkflow() {
  for (let hour = 0; hour < HOURS_PER_RUN; hour++) {
    try {
      await searchForMissingThreeHoursPosts();
    } catch (err) {
      // Try again next hour.
    }
    await sleep('1 hour');
  }

  await continueAsNew<typeof missingPostWorkflow>();
}
