import { continueAsNew, patched, proxyActivities, sleep } from '@temporalio/workflow';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';

const { searchForMissingThreeHoursPosts } = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

// Its own options: one short try. A slow platform must not hold the search
// for posts left in QUEUE (three 10-minute attempts would); the next hour
// checks again.
const { checkChannelsBeforePosting } = proxyActivities<PostActivity>({
  startToCloseTimeout: '5 minute',
  retry: { maximumAttempts: 1 },
});

// Hours per run before handing over to a fresh execution, so the history
// stays small instead of growing for as long as the backend lives.
const HOURS_PER_RUN = 24;

// Started once by the backend when RUN_CRON is set (InfiniteWorkflowRegister).
// It is the only thing that re-pokes a post left in QUEUE past its time, so it
// must not die: a failed search (a database blip after the three retries) used
// to fail the whole workflow, and nothing restarted it until the next deploy.
export async function missingPostWorkflow() {
  for (let hour = 0; hour < HOURS_PER_RUN; hour++) {
    try {
      await searchForMissingThreeHoursPosts();
    } catch (err) {
      // Try again next hour.
    }
    // Behind a patch: the run alive at the deploy replays its history, which
    // has no such activity (scripts/replay-histories.mjs).
    if (patched('channel-check-before-posting')) {
      try {
        await checkChannelsBeforePosting();
      } catch (err) {
        // A failed check is not a reason to stop the sweep.
      }
    }
    await sleep('1 hour');
  }

  await continueAsNew<typeof missingPostWorkflow>();
}
