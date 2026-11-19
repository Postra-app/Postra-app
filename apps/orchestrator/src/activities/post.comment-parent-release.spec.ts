jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { PostActivity } from './post.activity';

// A TikTok post published while TikTok was still reviewing it keeps its
// publish id and a link to the profile. Its first comment waits for the
// public id; the post now takes that id and link too.
describe('a comment that learns the post\'s public id', () => {
  const setup = (parentReleaseId: string) => {
    jest.spyOn(AuthService, 'decryptIntegrationToken').mockImplementation((v: any) => v);
    const comment = { id: 'c1', parentPostId: 'p1', content: 'Hi', settings: '{}', image: '[]' };
    const provider = {
      editor: 'normal',
      comment: jest.fn(async () => [
        {
          id: 'c1',
          postId: 'cm-1',
          releaseURL: 'https://www.tiktok.com/@a/video/76',
          status: 'success',
          parentRelease: { postId: '76', releaseURL: 'https://www.tiktok.com/@a/video/76' },
        },
      ]),
    };
    const postService = {
      getPostById: jest.fn(async (id: string) =>
        id === 'p1' ? { id: 'p1', releaseId: parentReleaseId } : { id, releaseId: null }
      ),
      updateTags: jest.fn().mockResolvedValue([comment]),
      updateMedia: jest.fn().mockResolvedValue([]),
      updatePost: jest.fn(),
      updateResolvedRelease: jest.fn(),
    };
    const activity = Object.create(PostActivity.prototype) as any;
    Object.assign(activity, {
      _logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
      _integrationManager: { getSocialIntegration: () => provider },
      _integrationService: {},
      _postService: postService,
    });
    const integration = { id: 'i1', organizationId: 'o1', providerIdentifier: 'mastodon', internalId: 'x', token: 't', refreshToken: null as string | null };
    return { activity, postService, comment, integration };
  };

  it('gives the post its public id and link', async () => {
    const { activity, postService, comment, integration } = setup('v_pub_url~1');
    await activity.postCommentBody('v_pub_url~1', undefined, integration, [comment]);
    expect(postService.updatePost).toHaveBeenCalledWith('c1', 'cm-1', 'https://www.tiktok.com/@a/video/76', 'o1');
    expect(postService.updateResolvedRelease).toHaveBeenCalledWith(
      'p1',
      'o1',
      '76',
      'https://www.tiktok.com/@a/video/76'
    );
  });

  it('leaves a post that already has another id alone', async () => {
    const { activity, postService, comment, integration } = setup('76');
    await activity.postCommentBody('v_pub_url~1', undefined, integration, [comment]);
    expect(postService.updateResolvedRelease).not.toHaveBeenCalled();
  });
});
