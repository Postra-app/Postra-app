import 'reflect-metadata';
import { google } from 'googleapis';
import {
  YOUTUBE_COMMENT_SCOPE,
  YoutubeProvider,
  youtubeCommentsOffered,
} from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';
import { commentSupport } from '@gitroom/nestjs-libraries/integrations/social/comment.capability';

// First comment on YouTube needs youtube.force-ssl. Google has not verified
// Postra for it yet, so the sign-in asks for it only where comments are
// offered: a Postra administrator and the preview organisations, until
// YOUTUBE_COMMENTS_FOR says everyone.
describe('YouTube first comment', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
    jest.restoreAllMocks();
  });

  const scopesOf = (url: string) => new URL(url).searchParams.get('scope')!.split(' ');

  it('asks for the comment scope only when comments are offered', async () => {
    process.env = { ...env, FRONTEND_URL: 'https://app.example.test', YOUTUBE_CLIENT_ID: 'id' };
    const plain = await new YoutubeProvider().generateAuthUrl();
    expect(scopesOf(plain.url)).not.toContain(YOUTUBE_COMMENT_SCOPE);
    const withComments = await new YoutubeProvider().generateAuthUrl(undefined, { comments: true });
    expect(scopesOf(withComments.url)).toContain(YOUTUBE_COMMENT_SCOPE);
    expect(scopesOf(withComments.url)).toContain('https://www.googleapis.com/auth/youtube.upload');
  });

  it('offers comments to an administrator and a preview organisation, everyone only with the flag', () => {
    process.env = { ...env, PREVIEW_ORGANIZATIONS: 'org-preview' };
    delete process.env.YOUTUBE_COMMENTS_FOR;
    expect(youtubeCommentsOffered(false, 'org-1')).toBe(false);
    expect(youtubeCommentsOffered(true, 'org-1')).toBe(true);
    expect(youtubeCommentsOffered(false, 'org-preview')).toBe(true);
    process.env.YOUTUBE_COMMENTS_FOR = 'everyone';
    expect(youtubeCommentsOffered(false, 'org-1')).toBe(true);
  });

  it('a channel takes comments once it has the scope, and not before', () => {
    const provider = new YoutubeProvider();
    expect(commentSupport(provider, { grantedScopes: '[]' })).toBe('not_granted');
    expect(commentSupport(provider, { grantedScopes: JSON.stringify([YOUTUBE_COMMENT_SCOPE]) })).toBe('yes');
  });

  it('publishes the comment under the video and links to it', async () => {
    const insert = jest.fn(async () => ({ data: { id: 'Ugx-thread' } }));
    jest.spyOn(google, 'youtube').mockReturnValue({ commentThreads: { insert } } as any);
    const result = await new YoutubeProvider().comment(
      'internal',
      'vid123',
      undefined,
      'token',
      [{ id: 'c1', message: '  Early access: https://postra.co.uk  ', settings: {}, media: [] }] as any,
      {} as any
    );
    expect(insert).toHaveBeenCalledWith({
      part: ['snippet'],
      requestBody: {
        snippet: {
          videoId: 'vid123',
          topLevelComment: { snippet: { textOriginal: 'Early access: https://postra.co.uk' } },
        },
      },
    });
    expect(result).toEqual([
      {
        id: 'c1',
        postId: 'Ugx-thread',
        releaseURL: 'https://www.youtube.com/watch?v=vid123&lc=Ugx-thread',
        status: 'success',
      },
    ]);
  });

  it("refuses an empty comment and passes on YouTube's reason when it refuses", async () => {
    const empty = new YoutubeProvider().comment('i', 'v', undefined, 't', [{ id: 'c', message: ' ', settings: {}, media: [] }] as any, {} as any);
    await expect(empty).rejects.toThrow();
    jest.spyOn(google, 'youtube').mockReturnValue({
      commentThreads: { insert: jest.fn(async () => { throw Object.assign(new Error('The video has disabled comments.'), { code: 403 }); }) },
    } as any);
    await expect(
      new YoutubeProvider().comment('i', 'v', undefined, 't', [{ id: 'c', message: 'Hi', settings: {}, media: [] }] as any, {} as any)
    ).rejects.toMatchObject({ message: expect.stringContaining('disabled comments') });
  });
});
