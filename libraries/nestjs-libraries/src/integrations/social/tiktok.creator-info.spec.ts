import { TiktokProvider } from './tiktok.provider';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

// E2E-08-63: the composer's "Who can see this video?" list came back empty.
// TikTok access tokens live 24 h; past that creator_info answers 401 with no
// data, and creatorInfo turned it into an empty option list instead of asking
// for a token refresh, so a TikTok post could not be scheduled at all.
describe('TikTok creatorInfo', () => {
  const realFetch = global.fetch;
  let silence: jest.SpyInstance;

  const respond = (status: number, body: unknown) => {
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as any;
  };

  beforeEach(() => {
    silence = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = realFetch;
    silence.mockRestore();
  });

  it('asks for a token refresh when TikTok rejects the access token', async () => {
    // Real answer of open.tiktokapis.com to an invalid token (captured 2026-10-08).
    respond(401, {
      data: {},
      error: {
        code: 'access_token_invalid',
        message: 'The access token is invalid or not found in the request.',
        log_id: '20261008222720CCBA37BE7A3332CD67A6',
      },
    });

    await expect(
      new TiktokProvider().creatorInfo('act.expired')
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it('fails instead of returning an empty list when TikTok answers with an error', async () => {
    respond(200, {
      data: {},
      error: { code: 'spam_risk_too_many_posts', message: 'Too many posts', log_id: 'x' },
    });

    await expect(new TiktokProvider().creatorInfo('act.ok')).rejects.toThrow(
      'Too many posts'
    );
  });

  it("returns the creator's privacy options and restrictions", async () => {
    // Shape from TikTok's Content Posting API reference (creator_info/query).
    respond(200, {
      data: {
        creator_avatar_url: 'https://p16.tiktokcdn.com/avatar.jpeg',
        creator_username: 'postra',
        creator_nickname: 'Postra',
        privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: true,
        max_video_post_duration_sec: 300,
      },
      error: { code: 'ok', message: '', log_id: '202210112248442CB9319E1FB30C1073F3' },
    });

    await expect(new TiktokProvider().creatorInfo('act.ok')).resolves.toEqual({
      privacyOptions: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: true,
      maxDurationSeconds: 300,
      nickname: 'Postra',
      avatarUrl: 'https://p16.tiktokcdn.com/avatar.jpeg',
    });
  });
});
