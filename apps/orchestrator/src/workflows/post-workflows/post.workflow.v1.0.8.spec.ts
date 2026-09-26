/**
 * E2E-05-17 — measured on production 2026-09-26: a Telegram post failed with
 * "ETELEGRAM: 400 … caption is too long" (not a bad_body failure), turned red in
 * the calendar, and the user got no bell entry and no email. Only bad_body told
 * anyone anything. v1.0.8 notifies on every publish failure.
 */
const activities: Record<string, jest.Mock> = {};
jest.mock('@temporalio/workflow', () => {
  const common = jest.requireActual('@temporalio/common');
  return {
    ActivityFailure: common.ActivityFailure,
    ApplicationFailure: common.ApplicationFailure,
    proxyActivities: () =>
      new Proxy({}, { get: (_t, name: string) => (activities[name] ||= jest.fn()) }),
    defineSignal: () => 'poke',
    setHandler: () => undefined,
    sleep: () => Promise.resolve(),
    startChild: jest.fn(),
  };
});

import { ActivityFailure, ApplicationFailure } from '@temporalio/common';
import { postWorkflowV108 } from './post.workflow.v1.0.8';

const post = {
  id: 'p1',
  organizationId: 'org-1',
  state: 'QUEUE',
  publishDate: '2026-09-26T15:29:00.000Z',
  settings: '{"__type":"telegram"}',
  integration: { id: 'i1', providerIdentifier: 'telegram', name: 'Postra', organizationId: 'org-1' },
};

const run = () =>
  postWorkflowV108({ taskQueue: 'telegram', postId: 'p1', organizationId: 'org-1' });

beforeEach(() => {
  // The workflow destructures most activities at import time, so the mocks
  // must stay the same objects — reset them, never replace them.
  for (const fn of Object.values(activities)) fn.mockReset();
  const a = (name: string) => (activities[name] ||= jest.fn());
  a('getPost').mockResolvedValue(post);
  a('getPostsList').mockResolvedValue([post]);
  a('isCommentable').mockResolvedValue(false);
  a('internalPlugs').mockResolvedValue([]);
  a('globalPlugs').mockResolvedValue([]);
  a('sendWebhooks').mockResolvedValue(undefined);
});

const activityFailure = (cause: Error) =>
  new ActivityFailure('Activity task failed', 'postSocial', '3', 3 as any, 'w', cause);

describe('postWorkflowV108 — publish failures', () => {
  it('tells the user about a non-bad_body failure, with the platform reason', async () => {
    activities.postSocial = jest.fn().mockRejectedValue(
      activityFailure(
        ApplicationFailure.create({
          message: 'ETELEGRAM: 400 Bad Request: message caption is too long',
          type: 'TelegramError',
        })
      )
    );

    await run();

    expect(activities.changeState).toHaveBeenCalledWith('p1', 'ERROR', expect.anything(), [post]);
    const [org, title, body, , , type] = activities.inAppNotification.mock.calls.at(-1)!;
    expect(org).toBe('org-1');
    expect(title).toBe('Error posting on telegram for Postra');
    expect(body).toContain('message caption is too long');
    expect(body).toContain('Check the channel before trying again');
    expect(type).toBe('fail');
  });

  it('still reports bad_body the way it did', async () => {
    activities.postSocial = jest.fn().mockRejectedValue(
      activityFailure(
        ApplicationFailure.create({
          message: 'Cannot attach more than four files',
          type: 'bad_body',
          nonRetryable: true,
        })
      )
    );

    await run();

    const calls = activities.inAppNotification.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe(
      'An error occurred while posting on telegram: Cannot attach more than four files'
    );
  });

  it('says nothing extra when the post goes out', async () => {
    activities.postSocial = jest
      .fn()
      .mockResolvedValue([{ id: 'p1', postId: '9', releaseURL: 'https://t.me/x/9', status: 'completed' }]);

    await run();

    const types = activities.inAppNotification.mock.calls.map((c) => c[5]);
    expect(types).not.toContain('fail');
  });
});
