/**
 * U13 — restart-safe publishing. A deploy or watchdog restart mid-publish used
 * to leave the activity hanging until its 10-minute startToCloseTimeout, after
 * which the SDK retried it blindly (E2E-11-01, Plan/upstream_sync.md §0).
 * v1.0.9 retries a publish only when the activity never reached the platform.
 */
const activities: Record<string, jest.Mock> = {};
const sleeps: unknown[] = [];
jest.mock('@temporalio/workflow', () => {
  const common = jest.requireActual('@temporalio/common');
  return {
    ActivityFailure: common.ActivityFailure,
    ApplicationFailure: common.ApplicationFailure,
    proxyActivities: () =>
      new Proxy({}, { get: (_t, name: string) => (activities[name] ||= jest.fn()) }),
    defineSignal: () => 'poke',
    setHandler: () => undefined,
    sleep: (d: unknown) => {
      sleeps.push(d);
      return Promise.resolve();
    },
    startChild: jest.fn(),
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
  const a = (name: string) => (activities[name] ||= jest.fn());
  a('getPost').mockResolvedValue(post);
  a('getPostsList').mockResolvedValue([post]);
  a('isCommentable').mockResolvedValue(false);
  a('internalPlugs').mockResolvedValue([]);
  a('globalPlugs').mockResolvedValue([]);
  a('sendWebhooks').mockResolvedValue(undefined);
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
  // POSTS-3: the interval was counted from the start of the workflow, before
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
