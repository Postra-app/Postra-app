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

  // What the workflow really passes: getPostsList hands activities slimmed
  // posts (slimPost drops parentPostId), so the parent must come from the
  // database row, not from the post in the arguments (E2E-11-465, 19 XI:
  // the fix above never ran in production).
  const fromDb = (rows: Record<string, any>) => (id: string) =>
    Promise.resolve(rows[id] ?? null);

  it('finds the post from the database when the workflow passes a slimmed comment', async () => {
    const { activity, postService, comment, integration } = setup('v_pub_url~1');
    const { parentPostId: _dropped, ...slimmed } = comment;
    postService.getPostById.mockImplementation(
      fromDb({
        p1: { id: 'p1', parentPostId: null, releaseId: 'v_pub_url~1' },
        c1: { id: 'c1', parentPostId: 'p1', releaseId: null },
      })
    );
    await activity.postCommentBody('v_pub_url~1', undefined, integration, [slimmed]);
    expect(postService.updateResolvedRelease).toHaveBeenCalledWith(
      'p1',
      'o1',
      '76',
      'https://www.tiktok.com/@a/video/76'
    );
  });

  it('walks up a thread to the post itself from a later comment', async () => {
    const { activity, postService, comment, integration } = setup('v_pub_url~1');
    const second = { ...comment, id: 'c2' };
    delete (second as any).parentPostId;
    postService.getPostById.mockImplementation(
      fromDb({
        p1: { id: 'p1', parentPostId: null, releaseId: 'v_pub_url~1' },
        c1: { id: 'c1', parentPostId: 'p1', releaseId: 'cm-0' },
        c2: { id: 'c2', parentPostId: 'c1', releaseId: null },
      })
    );
    await activity.postCommentBody('v_pub_url~1', 'cm-0', integration, [second]);
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
