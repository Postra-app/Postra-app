import {
  continueAsNew,
  makeContinueAsNewFunc,
  patched,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';

const { setStreak, getLastPublishDate } = proxyActivities<EmailActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  cancellationType: 'ABANDON',
});

const DAY = 86400000;

/**
 * The publishing streak. It is shown in-app only (StreakComponent in the top
 * bar) and sends no email by design: "you lose your streak in two hours" is an
 * artificial deadline on a vanity metric, and every avoidable email spends
 * sender reputation that account activation and password resets depend on.
 */

/**
 * The first version, started with TERMINATE_EXISTING: every published post
 * killed the running workflow and started a new one. Posts now start
 * streakWorkflowV2 and no longer restart this one, so a run still sleeping at
 * deploy time hands the streak over instead of ending it a day after an old
 * post (upstream 273c7b50).
 */
export async function streakWorkflow({
  organizationId,
}: {
  organizationId: string;
}) {
  await setStreak(organizationId, 'start');
  await sleep(DAY);
  if (patched('streak-last-post')) {
    const lastPost = await getLastPublishDate(organizationId);
    if (lastPost && lastPost + DAY > Date.now()) {
      return await makeContinueAsNewFunc<typeof streakWorkflowV2>({
        workflowType: 'streakWorkflowV2',
      })({ organizationId, lastPost });
    }
  }
  await setStreak(organizationId, 'end');
}

/**
 * One run per organization, started with USE_EXISTING: a post during the
 * streak does not restart it. It wakes up when the last post is a day old and
 * ends the streak only if nothing newer was published.
 */
export async function streakWorkflowV2({
  organizationId,
  lastPost,
}: {
  organizationId: string;
  lastPost?: number;
}) {
  if (lastPost === undefined) {
    // Started by a publish.
    await setStreak(organizationId, 'start');
    lastPost = Date.now();
  }

  for (let check = 0; check < 30; check++) {
    await sleep(Math.max(1000, lastPost + DAY - Date.now()));
    lastPost = Math.max(
      lastPost,
      (await getLastPublishDate(organizationId)) || 0
    );
    if (lastPost + DAY > Date.now()) {
      continue;
    }
    await setStreak(organizationId, 'end');
    return;
  }

  // An organization that posts every day: keep the history short.
  return await continueAsNew<typeof streakWorkflowV2>({
    organizationId,
    lastPost,
  });
}
