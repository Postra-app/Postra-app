jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { PostActivity } from './post.activity';

// After a successful publish, a failure to start the streak reminder failed
// the publish activity, and its retry published again (upstream 273c7b50).
describe('postSocial after the post is out', () => {
  it('a streak reminder that cannot start does not fail the publish', async () => {
    jest.spyOn(AuthService, 'decryptIntegrationToken').mockImplementation((v: any) => v);
    delete process.env.STRIPE_SECRET_KEY;
    const post = { id: 'p1', content: 'Hello', settings: '{}', image: '[]' };
    const provider = { editor: 'normal', post: jest.fn().mockResolvedValue([{ id: 'p1', postId: 'r1', releaseURL: 'https://x.test/r1' }]) };
    const start = jest.fn().mockRejectedValue(new Error('temporal busy'));
    const activity = Object.create(PostActivity.prototype) as any;
    Object.assign(activity, {
      _logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
      _integrationManager: { getSocialIntegration: () => provider },
      _postService: {
        getPostById: jest.fn().mockResolvedValue({ id: 'p1', releaseId: null }),
        updateTags: jest.fn().mockResolvedValue([post]),
        updateMedia: jest.fn().mockResolvedValue([]),
        updatePost: jest.fn().mockResolvedValue(undefined),
      },
      _temporalService: { client: { getRawClient: () => ({ workflow: { start } }) } },
    });

    const result = await activity.postSocialBody(
      { id: 'i1', organizationId: 'o1', providerIdentifier: 'mastodon', internalId: 'x', token: 't', refreshToken: null },
      [post]
    );

    expect(provider.post).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: 'p1', postId: 'r1', releaseURL: 'https://x.test/r1' }]);
  });
});
