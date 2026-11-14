jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  delete process.env.REDIS_URL;
  return jest.requireActual('@gitroom/nestjs-libraries/redis/redis.service');
});

import { PostActivity } from './post.activity';

// The missing-post sweep loads the overdue QUEUE posts once, then starts a
// workflow for each. A post its own workflow published (or a customer
// deleted) in the meantime got a new run, and the workflow marks a post that
// is no longer in QUEUE as ERROR "Already posted": a published post shown as
// failed.
describe('missing-post sweep', () => {
  it('starts a workflow only for posts still waiting in the queue', async () => {
    const post = (id: string) => ({
      id,
      organizationId: 'o1',
      integration: { providerIdentifier: 'mastodon' },
    });
    const states: Record<string, { state: string } | null> = {
      waiting: { state: 'QUEUE' },
      published: { state: 'PUBLISHED' },
      deleted: null,
    };
    const signalWithStart = jest.fn().mockResolvedValue(undefined);
    const activity = Object.create(PostActivity.prototype) as any;
    Object.assign(activity, {
      _postService: {
        searchForMissingThreeHoursPosts: jest
          .fn()
          .mockResolvedValue([post('waiting'), post('published'), post('deleted')]),
        getCurrentState: jest.fn(async (id: string) => states[id]),
      },
      _temporalService: { client: { getRawClient: () => ({ workflow: { signalWithStart } }) } },
    });

    await activity.searchForMissingThreeHoursPosts();

    expect(signalWithStart).toHaveBeenCalledTimes(1);
    expect(signalWithStart.mock.calls[0][1].workflowId).toBe('post_waiting');
  });
});
