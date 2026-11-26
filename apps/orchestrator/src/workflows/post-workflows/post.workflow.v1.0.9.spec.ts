/**
 * Restart-safe publishing. A deploy or watchdog restart mid-publish used
 * to leave the activity hanging until its 10-minute startToCloseTimeout, after
 * which the SDK retried it blindly.
 * v1.0.9 retries a publish only when the activity never reached the platform.
 */
const activities: Record<string, jest.Mock> = {};
const sleeps: unknown[] = [];
// Patches a run does NOT have: a run that began before the patch shipped.
const unpatched = new Set<string>();
jest.mock('@temporalio/workflow', () => {
  const common = jest.requireActual('@temporalio/common');
  return {
    ActivityFailure: common.ActivityFailure,
    ApplicationFailure: common.ApplicationFailure,
    proxyActivities: () =>
      new Proxy({}, { get: (_t, name: string) => (activities[name] ||= jest.fn()) }),
    defineSignal: () => 'poke',
    setHandler: (): undefined => undefined,
    sleep: (d: unknown) => {
      sleeps.push(d);
      return Promise.resolve();
    },
    startChild: jest.fn(),
    patched: (id: string) => !unpatched.has(id),
  };
});

import {
  ActivityFailure,
  ApplicationFailure,
  TimeoutFailure,
  TimeoutType,
} from '@temporalio/common';
import { postWorkflowV109, publishRetry } from './post.workflow.v1.0.9';

const integration = {
  id: 'i1',
  providerIdentifier: 'telegram',
  name: 'Postra',
  organizationId: 'org-1',
};
const post = {
  id: 'p1',
  organizationId: 'org-1',
  state: 'QUEUE',
  publishDate: '2026-10-02T15:29:00.000Z',
  settings: '{"__type":"telegram"}',
  integration,
};
const comment = { ...post, id: 'c1', delay: 5 };
const published = [{ id: 'p1', postId: '9', releaseURL: 'https://t.me/x/9', status: 'completed' }];

const run = () =>
  postWorkflowV109({ taskQueue: 'telegram', postId: 'p1', organizationId: 'org-1' });

beforeEach(() => {
  for (const fn of Object.values(activities)) fn.mockReset();
  sleeps.length = 0;
  unpatched.clear();
  const a = (name: string) => (activities[name] ||= jest.fn());
  a('getPost').mockResolvedValue(post);
  a('getPostsList').mockResolvedValue([post]);
  a('isCommentable').mockResolvedValue(false);
  a('internalPlugs').mockResolvedValue([]);
  a('globalPlugs').mockResolvedValue([]);
  a('sendWebhooks').mockResolvedValue(undefined);
  a('notSentWithoutPlan').mockResolvedValue(false);
});

const failure = (cause: Error, activity = 'postSocial') =>
  new ActivityFailure('Activity task failed', activity, '1', 3 as any, 'w', cause);
const heartbeatTimeout = (details?: string) =>
  failure(new TimeoutFailure('activity Heartbeat timeout', details, TimeoutType.HEARTBEAT));
const startToCloseTimeout = () =>
  failure(new TimeoutFailure('activity StartToClose timeout', undefined, TimeoutType.START_TO_CLOSE));
const notifications = () => activities.inAppNotification.mock.calls.map((c) => c[5]);

describe('publishRetry', () => {
  it.each([
    ['heartbeat timeout, no details (worker never ran it)', heartbeatTimeout(), 'now'],
    ['heartbeat timeout while preparing media', heartbeatTimeout('postSocial: entered'), 'now'],
    ['heartbeat timeout after publishing started', heartbeatTimeout('publish: telegram'), 'no'],
    ['startToClose timeout', startToCloseTimeout(), 'no'],
    ['ordinary error', failure(ApplicationFailure.create({ message: 'ECONNRESET' })), 'later'],
    ['bad_body', failure(ApplicationFailure.create({ type: 'bad_body', nonRetryable: true })), 'no'],
    ['not an activity failure', new Error('x'), 'no'],
  ])('%s → %s', (_name, err, expected) => {
    expect(publishRetry(err)).toBe(expected);
  });
});

describe('postWorkflowV109 — worker restarts mid-publish', () => {
  it('worker killed before sending: retried at once, published once', async () => {
    activities.postSocial = jest
      .fn()
      .mockRejectedValueOnce(heartbeatTimeout('postSocial: entered'))
      .mockResolvedValueOnce(published);

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(2);
    expect(sleeps).not.toContain('2 minutes');
    expect(activities.updatePost).toHaveBeenCalledWith('p1', '9', 'https://t.me/x/9', 'org-1');
    expect(activities.changeState).not.toHaveBeenCalled();
    expect(notifications()).not.toContain('fail');
  });

  it('worker killed after sending: not retried, user asked to check the channel', async () => {
    activities.postSocial = jest.fn().mockRejectedValue(heartbeatTimeout('publish: telegram'));

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(1);
    expect(activities.changeState).toHaveBeenCalledWith('p1', 'ERROR', expect.anything(), [post]);
    const body = activities.inAppNotification.mock.calls.at(-1)![2];
    expect(body).toContain('Check the channel before trying again');
  });

  it('activity hung for the whole startToClose budget: not retried', async () => {
    activities.postSocial = jest.fn().mockRejectedValue(startToCloseTimeout());

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(1);
    expect(notifications()).toContain('fail');
  });

  it('keeps v1.0.8 retries for ordinary errors: 3 attempts, 2 minutes apart', async () => {
    activities.postSocial = jest
      .fn()
      .mockRejectedValue(failure(ApplicationFailure.create({ message: 'ECONNRESET' })));

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(3);
    expect(sleeps.filter((d) => d === '2 minutes')).toHaveLength(2);
    expect(notifications()).toContain('fail');
  });

  it('a worker that keeps dying before sending is retried twice, then reported', async () => {
    activities.postSocial = jest.fn().mockRejectedValue(heartbeatTimeout());

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(3);
    expect(notifications()).toContain('fail');
  });

  it('bad_body is still not retried', async () => {
    activities.postSocial = jest
      .fn()
      .mockRejectedValue(failure(ApplicationFailure.create({ type: 'bad_body', nonRetryable: true, message: 'too long' })));

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(1);
  });

  it('comment whose worker died before sending: retried without waiting its delay again', async () => {
    activities.getPostsList.mockResolvedValue([post, comment]);
    activities.isCommentable.mockResolvedValue(true);
    activities.postSocial = jest.fn().mockResolvedValue(published);
    activities.postComment = jest
      .fn()
      .mockRejectedValueOnce(heartbeatTimeout('postComment: entered'))
      .mockResolvedValueOnce([{ id: 'c1', postId: '10', releaseURL: 'https://t.me/x/10', status: 'completed' }]);

    await run();

    expect(activities.postComment).toHaveBeenCalledTimes(2);
    expect(sleeps.filter((d) => d === 5 * 60000)).toHaveLength(1);
    expect(activities.updatePost).toHaveBeenCalledWith('c1', '10', 'https://t.me/x/10', 'org-1');
  });
});

describe('postWorkflowV109 — repeating posts', () => {
  // The interval was counted from the start of the workflow, before
  // the wait for the publish date, so a post scheduled 10 days ahead with a
  // 1-day interval repeated right after it went out.
  it('the first repeat comes one interval after the post, not at once', async () => {
    const now = new Date('2026-10-05T12:00:00.000Z').getTime();
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const temporal = jest.requireMock('@temporalio/workflow');
    const realSleep = temporal.sleep;
    temporal.sleep = (d: unknown) => {
      sleeps.push(d);
      if (typeof d === 'number') jest.setSystemTime(Date.now() + d);
      return Promise.resolve();
    };
    try {
      const repeating = {
        ...post,
        publishDate: new Date(now + 10 * 86_400_000).toISOString(),
        intervalInDays: 1,
      };
      activities.getPost.mockResolvedValue(repeating);
      activities.getPostsList.mockResolvedValue([repeating]);
      activities.postSocial = jest.fn().mockResolvedValue(published);

      await run();

      const day = 86_400_000;
      // The wait for the publish date, then the wait for the repeat.
      expect(sleeps[0]).toBe(10 * day);
      expect(sleeps[sleeps.length - 1]).toBeGreaterThan(day - 60_000);
      expect(temporal.startChild).toHaveBeenCalled();
    } finally {
      temporal.sleep = realSleep;
      jest.useRealTimers();
    }
  });
});

describe('postWorkflowV109 — after the platform has the post', () => {
  // A notification that could not be sent turned a published post
  // into an error and stopped its comments.
  it('a failed notification neither marks the post failed nor stops its comment', async () => {
    activities.getPostsList.mockResolvedValue([post, comment]);
    activities.isCommentable.mockResolvedValue(true);
    activities.postSocial = jest.fn().mockResolvedValue(published);
    activities.postComment = jest.fn().mockResolvedValue([{ id: 'c1', postId: '10', releaseURL: 'https://t.me/x/10', status: 'completed' }]);
    activities.inAppNotification.mockRejectedValue(new Error('notification activity failed'));

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(1);
    expect(activities.inAppNotification).toHaveBeenCalled();
    expect(activities.postComment).toHaveBeenCalledTimes(1);
    expect(activities.changeState).not.toHaveBeenCalledWith('p1', 'ERROR', expect.anything(), expect.anything());
  });
});

describe('postWorkflowV109 — the platform by its name', () => {
  // The notification and mail read "published on Linkedin-page" (the
  // provider identifier, capitalised), "Tiktok", "Youtube".
  it('names the platform as customers know it in the published notification', async () => {
    const page = { ...integration, providerIdentifier: 'linkedin-page' };
    activities.getPost.mockResolvedValue({ ...post, integration: page });
    activities.getPostsList.mockResolvedValue([{ ...post, integration: page }]);
    activities.postSocial = jest.fn().mockResolvedValue(published);

    await run();

    const [, subject, body] = activities.inAppNotification.mock.calls[0];
    expect(subject).toBe('Your post has been published on LinkedIn Page');
    expect(body).toBe('Your post has been published on LinkedIn Page at https://t.me/x/9');
  });

  // The phone's push carries the post, so a tap opens it, not the calendar.
  it('names the published post in the notification', async () => {
    activities.postSocial = jest.fn().mockResolvedValue(published);
    await run();
    const call = activities.inAppNotification.mock.calls[0];
    expect(call[6]).toBe(post.id);
  });
});

describe('postWorkflowV109 — a channel that cannot post', () => {
  // A channel that needs reconnecting told the customer to "enable it", which
  // is the advice for a disabled one; enabling does nothing.
  it('asks to reconnect a channel that needs reconnecting', async () => {
    const stale = { ...integration, providerIdentifier: 'tiktok', refreshNeeded: true };
    activities.getPostsList.mockResolvedValue([{ ...post, integration: stale }]);

    await run();

    const [, subject, body] = activities.inAppNotification.mock.calls[0];
    expect(subject).toBe("We couldn't post to TikTok for Postra");
    expect(body).toBe(
      "We couldn't post to TikTok for Postra because the channel needs to be reconnected. Open its menu, choose Reconnect channel and try again."
    );
    expect(activities.postSocial).not.toHaveBeenCalled();
  });

  it('asks to enable a disabled channel', async () => {
    const off = { ...integration, providerIdentifier: 'linkedin-page', disabled: true };
    activities.getPostsList.mockResolvedValue([{ ...post, integration: off }]);

    await run();

    const [, subject, body] = activities.inAppNotification.mock.calls[0];
    expect(subject).toBe("We couldn't post to LinkedIn Page for Postra");
    expect(body).toBe(
      "We couldn't post to LinkedIn Page for Postra because it's disabled. Please enable it and try again."
    );
  });
});

describe('postWorkflowV109 — a post edited while its run was waiting', () => {
  // An edit ends the old run only if Temporal answers at that moment. When it
  // did not, the old run woke at the old time and published a post its
  // author had turned back into a draft or moved to a later date.
  const untouched = () => {
    expect(activities.postSocial).not.toHaveBeenCalled();
    expect(activities.changeState).not.toHaveBeenCalled();
    expect(activities.inAppNotification).not.toHaveBeenCalled();
    expect(activities.sendWebhooks).not.toHaveBeenCalled();
  };

  it('does not publish a post that became a draft during the wait', async () => {
    activities.getPostsList.mockResolvedValue([{ ...post, state: 'DRAFT' }]);

    await run();

    untouched();
  });

  it('does not publish a post that was moved to a later date during the wait', async () => {
    const later = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    activities.getPostsList.mockResolvedValue([{ ...post, publishDate: later }]);

    await run();

    untouched();
  });

  it('publishes a post that is due, a few seconds early included', async () => {
    const dueNow = new Date(Date.now() + 5000).toISOString();
    activities.getPostsList.mockResolvedValue([{ ...post, publishDate: dueNow }]);
    activities.postSocial = jest.fn().mockResolvedValue(published);

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(1);
  });

  it('a repeat of a published post still goes out', async () => {
    activities.getPost.mockResolvedValue({ ...post, state: 'PUBLISHED' });
    activities.getPostsList.mockResolvedValue([{ ...post, state: 'PUBLISHED' }]);
    activities.postSocial = jest.fn().mockResolvedValue(published);

    await postWorkflowV109({
      taskQueue: 'telegram',
      postId: 'p1',
      organizationId: 'org-1',
      postNow: true,
    });

    expect(activities.postSocial).toHaveBeenCalledTimes(1);
  });

  it('a run from before this check replays as it ran', async () => {
    unpatched.add('recheck-post-after-wait');
    activities.getPostsList.mockResolvedValue([{ ...post, state: 'DRAFT' }]);
    activities.postSocial = jest.fn().mockResolvedValue(published);

    await run();

    expect(activities.postSocial).toHaveBeenCalledTimes(1);
  });
});

describe('postWorkflowV109 — plug checks', () => {
  // Every delay is counted from the publish, but
  // each sleep was the full delay again, so a plug checking every 6 h ran at
  // 6, 18 and 36 h instead of 6, 12 and 18 h, and a repeating post with a
  // plug slipped by up to a day and a half each cycle.
  it('checks a plug at its times after the post, not at their sum', async () => {
    const now = new Date('2026-10-05T12:00:00.000Z').getTime();
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const temporal = jest.requireMock('@temporalio/workflow');
    const realSleep = temporal.sleep;
    const at: number[] = [];
    temporal.sleep = (d: unknown) => {
      if (typeof d === 'number') jest.setSystemTime(Date.now() + d);
      at.push(Date.now());
      return Promise.resolve();
    };
    try {
      const hour = 3_600_000;
      activities.getPost.mockResolvedValue({ ...post, publishDate: new Date(now).toISOString() });
      activities.getPostsList.mockResolvedValue([post]);
      activities.postSocial = jest.fn().mockResolvedValue(published);
      activities.globalPlugs.mockResolvedValue([
        { type: 'global', delay: 6 * hour, totalRuns: 3, plugId: 'pl1', integration: 'i1' },
      ]);
      activities.processPlug = jest.fn().mockResolvedValue(false);

      await run();

      const afterPost = at.slice(-3).map((t) => Math.round((t - now) / hour));
      expect(afterPost).toEqual([6, 12, 18]);
    } finally {
      temporal.sleep = realSleep;
      jest.useRealTimers();
    }
  });
});

describe('postWorkflowV109 — a plug whose outcome is unknown', () => {
  // An automatic comment or repost that failed after its request may have
  // reached the platform used to be tried again, up to five times here on top
  // of the SDK's three: a second comment under the customer's post.
  const unknown = (activity: string) =>
    failure(
      ApplicationFailure.create({ type: 'publish_unknown', nonRetryable: true, message: 'fetch failed' }),
      activity
    );
  beforeEach(() => {
    activities.postSocial = jest.fn().mockResolvedValue(published);
  });

  it('does not repeat a comment from another channel', async () => {
    activities.internalPlugs.mockResolvedValue([
      { type: 'internal-plug', delay: 0, integration: 'i2', plugName: 'comment' },
    ]);
    activities.processInternalPlug = jest.fn().mockRejectedValue(unknown('processInternalPlug'));

    await run();

    expect(activities.processInternalPlug).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a plug of the channel itself', async () => {
    activities.globalPlugs.mockResolvedValue([
      { type: 'global', delay: 0, totalRuns: 1, plugId: 'pl1', integration: 'i1' },
    ]);
    activities.processPlug = jest.fn().mockRejectedValue(unknown('processPlug'));

    await run();

    expect(activities.processPlug).toHaveBeenCalledTimes(1);
  });

  it('still repeats a plug the platform never received', async () => {
    activities.internalPlugs.mockResolvedValue([
      { type: 'internal-plug', delay: 0, integration: 'i2', plugName: 'comment' },
    ]);
    activities.processInternalPlug = jest
      .fn()
      .mockRejectedValueOnce(failure(ApplicationFailure.create({ message: 'ECONNREFUSED' }), 'processInternalPlug'))
      .mockResolvedValueOnce(undefined);

    await run();

    expect(activities.processInternalPlug).toHaveBeenCalledTimes(2);
  });

  it('a run from before this change replays its retries', async () => {
    unpatched.add('plug-outcome-unknown');
    activities.internalPlugs.mockResolvedValue([
      { type: 'internal-plug', delay: 0, integration: 'i2', plugName: 'comment' },
    ]);
    activities.processInternalPlug = jest.fn().mockRejectedValue(unknown('processInternalPlug'));

    await run();

    expect(activities.processInternalPlug).toHaveBeenCalledTimes(5);
  });
});

describe('postWorkflowV109 — comments the channel cannot take', () => {
  // 2026-10-10: a first comment on a TikTok post was reported as "TikTok has
  // not granted this channel the permission needed to post comments", which
  // sent the user looking for a permission. TikTok's API has no comments.
  const tiktok = { ...integration, providerIdentifier: 'tiktok' };
  const tiktokPost = { ...post, integration: tiktok };
  const tiktokComment = { ...tiktokPost, id: 'c1', delay: 0 };

  beforeEach(() => {
    activities.getPost.mockResolvedValue(tiktokPost);
    activities.getPostsList.mockResolvedValue([tiktokPost, tiktokComment]);
    activities.postSocial = jest.fn().mockResolvedValue(published);
  });

  const commentError = () =>
    activities.changeState.mock.calls.find((c) => c[0] === 'c1')?.[2];
  const notificationBody = () =>
    activities.inAppNotification.mock.calls.find((c) =>
      String(c[1]).includes('without its comments')
    )?.[2];

  it('says the platform has no comment API, not that a permission is missing', async () => {
    activities.commentSupport.mockResolvedValue('no_api');

    await run();

    expect(commentError()).toBe("Comment not published: TikTok doesn't let apps post comments.");
    expect(notificationBody()).toContain("TikTok doesn't let apps post comments");
    expect(notificationBody()).not.toContain('permission');
    expect(notificationBody()).not.toMatch(/[—–]/);
  });

  it('keeps the permission wording when the platform has the API but not the grant', async () => {
    activities.commentSupport.mockResolvedValue('not_granted');

    await run();

    expect(commentError()).toBe(
      'Comment not published: TikTok has not granted this channel the permission needed to post comments.'
    );
    expect(notificationBody()).not.toMatch(/[—–]/);
  });
});

describe('postWorkflowV109 — a post due after the plan ended', () => {
  // A post scheduled during a trial for a time after it: the trial ended
  // (no card), the plan with it, and the post turned red as "No Post" with
  // nothing said. It is not sent, it says why, and the customer is told.
  it('is not sent, and says the plan has ended', async () => {
    activities.getPostsList.mockResolvedValue([]);
    activities.notSentWithoutPlan.mockResolvedValue(true);

    await run();

    expect(activities.notSentWithoutPlan).toHaveBeenCalledWith('org-1', 'p1');
    expect(activities.changeState).not.toHaveBeenCalledWith('p1', 'ERROR', 'No Post');
    expect(activities.postSocial).not.toHaveBeenCalled();
  });

  it('a post that is gone is still "No Post"', async () => {
    activities.getPostsList.mockResolvedValue([]);
    activities.notSentWithoutPlan.mockResolvedValue(false);

    await run();

    expect(activities.changeState).toHaveBeenCalledWith('p1', 'ERROR', 'No Post');
  });

  it('a run from before the change keeps "No Post"', async () => {
    unpatched.add('post-not-sent-without-plan');
    activities.getPostsList.mockResolvedValue([]);

    await run();

    expect(activities.notSentWithoutPlan).not.toHaveBeenCalled();
    expect(activities.changeState).toHaveBeenCalledWith('p1', 'ERROR', 'No Post');
  });
});
