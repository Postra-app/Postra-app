jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

// The in-memory Redis, not whatever REDIS_URL the shell has.
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  delete process.env.REDIS_URL;
  return jest.requireActual('@gitroom/nestjs-libraries/redis/redis.service');
});

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { PostActivity } from './post.activity';

// POSTS-1: rescheduling a post while it was going out terminated its workflow
// and started another, which found no saved release yet and published the
// post a second time.
describe('two runs publishing the same post', () => {
  it('the second waits for a retry, which finds the first one\'s release', async () => {
    jest.spyOn(AuthService, 'decryptIntegrationToken').mockImplementation((v: any) => v);
    delete process.env.STRIPE_SECRET_KEY;
    const post = { id: 'p-lock', content: 'Hello', settings: '{}', image: '[]' };
    let release: string | null = null;
    let finishFirst!: () => void;
    const provider = {
      editor: 'normal',
      post: jest.fn(
        () =>
          new Promise((res) => {
            finishFirst = () => res([{ id: 'p-lock', postId: 'r1', releaseURL: 'https://x.test/r1' }]);
          })
      ),
    };
    const activity = Object.create(PostActivity.prototype) as any;
    Object.assign(activity, {
      _logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
      _integrationManager: { getSocialIntegration: () => provider },
      _postService: {
        getPostById: jest.fn(async () => ({ id: 'p-lock', releaseId: release, releaseURL: release && 'https://x.test/r1' })),
        updateTags: jest.fn().mockResolvedValue([post]),
        updateMedia: jest.fn().mockResolvedValue([]),
        updatePost: jest.fn(async (_id: string, postId: string) => {
          release = postId;
        }),
      },
      _temporalService: { client: { getRawClient: () => ({ workflow: { start: jest.fn() } }) } },
    });
    const integration = () => ({ id: 'i1', organizationId: 'o1', providerIdentifier: 'mastodon', internalId: 'x', token: 't', refreshToken: null });

    const first = activity.postSocialBody(integration(), [post]);
    for (let i = 0; i < 200 && !provider.post.mock.calls.length; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(provider.post).toHaveBeenCalledTimes(1);

    // The rescheduled workflow's run, while the first is still at the platform.
    await expect(activity.postSocialBody(integration(), [post])).rejects.toThrow('being published by another run');

    finishFirst();
    await first;

    // Its retry: the release is saved, nothing goes out again.
    const retry = await activity.postSocialBody(integration(), [post]);
    expect(retry[0].postId).toBe('r1');
    expect(provider.post).toHaveBeenCalledTimes(1);
  });
});
