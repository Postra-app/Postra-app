import { TiktokProvider } from './tiktok.provider';
import { canPostComments, commentSupport } from './comment.capability';
import {
  TIKTOK_COMMENT_SCOPE,
  openTiktokBusinessAccess,
  sameTiktokAccount,
  sealTiktokBusinessAccess,
  tiktokBusinessAuthUrl,
  tiktokBusinessExchangeCode,
  tiktokBusinessNeedsRefresh,
  tiktokBusinessRefresh,
} from './tiktok.business';

// First comment on TikTok. The Content Posting API has no comment, so TikTok
// had none in Postra at all; TikTok API for Business has one behind a second
// authorization, which a TikTok channel carries next to its own token once
// its owner turns first comment on.

jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn(async () => undefined),
}));

const env = { ...process.env };
const realFetch = global.fetch;
beforeEach(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  process.env.TIKTOK_BUSINESS_APP_ID = '7000000000000000001';
  process.env.TIKTOK_BUSINESS_SECRET = 'app-secret';
  process.env.FRONTEND_URL = 'https://app.example.test';
  delete process.env.TIKTOK_URL;
});
afterEach(() => {
  global.fetch = realFetch;
  process.env = { ...env };
});

type Call = { url: string; init: any; body: any };
const answers = (reply: (url: string, body: any) => unknown) => {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), init, body });
    // A string is a raw body: TikTok's post ids are past 2^53, and the
    // provider reads them from the text.
    const data = reply(String(url), body);
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(raw),
      text: async () => raw,
    } as unknown as Response;
  }) as any;
  return calls;
};

const access = {
  openId: 'open-1',
  accessToken: 'act.1',
  refreshToken: 'rft.1',
  accessExpiresAt: Date.now() + 3600_000,
  refreshExpiresAt: Date.now() + 86400_000 * 300,
};

const channel = (over: Record<string, unknown> = {}) =>
  ({
    id: 'int-1',
    organizationId: 'org-1',
    profile: 'postra.co.uk',
    customInstanceDetails: sealTiktokBusinessAccess(access),
    grantedScopes: JSON.stringify([TIKTOK_COMMENT_SCOPE]),
    ...over,
  } as any);

const comment = (text = 'First comment') => [
  { id: 'post-comment-1', message: text, settings: {}, media: [] } as any,
];

const outcome = (p: Promise<unknown>) =>
  p.then(
    (value) => value,
    (e) => `${e.constructor.name}: ${e.message}`
  );

describe('TikTok first comment: who can', () => {
  it('a channel takes comments once it has the scope of the second authorization, and not before', () => {
    const provider = new TiktokProvider();
    expect(commentSupport(provider, { grantedScopes: null })).toBe(
      'not_granted'
    );
    expect(canPostComments(provider, channel())).toBe(true);
  });
});

describe('TikTok first comment: the second authorization', () => {
  it('asks TikTok for the comment scope with the Business app and its own return address', () => {
    const url = new URL(tiktokBusinessAuthUrl('state-1'));
    expect(url.origin + url.pathname).toBe(
      'https://www.tiktok.com/v2/auth/authorize'
    );
    expect(url.searchParams.get('client_key')).toBe('7000000000000000001');
    expect(url.searchParams.get('scope')!.split(',')).toContain(
      TIKTOK_COMMENT_SCOPE
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.test/integrations/social/tiktok-business'
    );
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  it('keeps the return address on TIKTOK_URL, where the Business app has it registered', () => {
    process.env.TIKTOK_URL = 'https://old.example.test';
    expect(
      new URL(tiktokBusinessAuthUrl('s')).searchParams.get('redirect_uri')
    ).toBe('https://old.example.test/integrations/social/tiktok-business');
  });

  it('exchanges the code for tokens and reads the scopes TikTok gave', async () => {
    const calls = answers(() => ({
      code: 0,
      data: {
        access_token: 'act.9',
        refresh_token: 'rft.9',
        expires_in: 86400,
        refresh_token_expires_in: 31536000,
        open_id: 'open-9',
        scope: 'user.info.basic,comment.list.manage',
      },
    }));
    const got = await tiktokBusinessExchangeCode('code-1');
    expect(calls[0].url).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/'
    );
    expect(calls[0].body).toEqual({
      client_id: '7000000000000000001',
      client_secret: 'app-secret',
      grant_type: 'authorization_code',
      auth_code: 'code-1',
      redirect_uri:
        'https://app.example.test/integrations/social/tiktok-business',
    });
    expect(got.openId).toBe('open-9');
    expect(got.scopes).toEqual(['user.info.basic', 'comment.list.manage']);
  });

  it('says what TikTok said when it refuses', async () => {
    answers(() => ({ code: 40002, message: 'Auth code is invalid' }));
    expect(await outcome(tiktokBusinessExchangeCode('bad'))).toBe(
      'TiktokBusinessError: TikTok could not finish the sign-in (Auth code is invalid)'
    );
  });

  it('a renewal keeps the account and the refresh token when TikTok sends neither again', async () => {
    answers(() => ({
      code: 0,
      data: { access_token: 'act.2', expires_in: 86400 },
    }));
    const renewed = await tiktokBusinessRefresh(access);
    expect(renewed.accessToken).toBe('act.2');
    expect(renewed.openId).toBe('open-1');
    expect(renewed.refreshToken).toBe('rft.1');
  });

  it('is stored encrypted and read back; anything else reads as no access', () => {
    const sealed = sealTiktokBusinessAccess(access);
    expect(sealed).not.toContain('act.1');
    expect(openTiktokBusinessAccess(sealed)).toEqual(access);
    expect(openTiktokBusinessAccess(null)).toBeUndefined();
    expect(openTiktokBusinessAccess('not ours')).toBeUndefined();
  });

  it('is due for renewal shortly before the one-day token runs out', () => {
    expect(tiktokBusinessNeedsRefresh(access)).toBe(false);
    expect(
      tiktokBusinessNeedsRefresh({ ...access, accessExpiresAt: Date.now() + 60_000 })
    ).toBe(true);
  });

  it('compares the TikTok account whatever the case or the @', () => {
    expect(sameTiktokAccount('@Postra.co.uk', 'postra.co.uk')).toBe(true);
    expect(sameTiktokAccount('someone', 'postra.co.uk')).toBe(false);
    expect(sameTiktokAccount('', '')).toBe(false);
  });
});

describe('TikTok first comment: publishing', () => {
  it('publishes the comment under the public post with the Business access', async () => {
    const calls = answers((url) =>
      url.includes('/business/comment/create/')
        ? { code: 0, data: { comment_id: '7700000000000000009' } }
        : {
            code: 0,
            data: {
              videos: [
                {
                  item_id: '7600000000000000001',
                  share_url:
                    'https://www.tiktok.com/@postra.co.uk/video/7600000000000000001?utm_campaign=tt4d_open_api&utm_source=7000000000000000001',
                },
              ],
            },
          }
    );
    const result = await new TiktokProvider().comment(
      'internal',
      '7600000000000000001',
      undefined,
      'channel-token',
      comment(),
      channel()
    );
    const create = calls.find((c) => c.url.includes('/comment/create/'))!;
    expect(create.init.headers['Access-Token']).toBe('act.1');
    expect(create.body).toEqual({
      business_id: 'open-1',
      video_id: '7600000000000000001',
      text: 'First comment',
    });
    expect(result).toEqual([
      {
        id: 'post-comment-1',
        postId: '7700000000000000009',
        releaseURL:
          'https://www.tiktok.com/@postra.co.uk/video/7600000000000000001',
        status: 'success',
      },
    ]);
  });

  it('waits for the public id of a post TikTok was still reviewing', async () => {
    let asked = 0;
    const calls = answers((url) => {
      if (url.includes('/post/publish/status/fetch/')) {
        asked++;
        return asked < 3
          ? { data: { status: 'PUBLISH_COMPLETE' } }
          : '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7600000000000000002]}}';
      }
      return url.includes('/comment/create/')
        ? { code: 0, data: { comment_id: 'c-1' } }
        : { code: 0, data: { videos: [] } };
    });
    const result: any = await new TiktokProvider().comment(
      'internal',
      'v_pub_url~v2.123',
      undefined,
      'channel-token',
      comment(),
      channel()
    );
    expect(asked).toBe(3);
    expect(
      calls.find((c) => c.url.includes('/comment/create/'))!.body.video_id
    ).toBe('7600000000000000002');
    // TikTok did not list the post: its link built from the public id, and
    // the post itself learns that id and link instead of keeping the
    // profile it got while TikTok was still reviewing it.
    expect(result[0].releaseURL).toBe(
      'https://www.tiktok.com/@postra.co.uk/video/7600000000000000002'
    );
    expect(result[0].parentRelease).toEqual({
      postId: '7600000000000000002',
      releaseURL: 'https://www.tiktok.com/@postra.co.uk/video/7600000000000000002',
    });
  });

  it('says why when the post never becomes public, and sends no comment', async () => {
    const calls = answers(() => ({ data: { status: 'PUBLISH_COMPLETE' } }));
    expect(
      await outcome(
        new TiktokProvider().comment(
          'internal',
          'v_pub_url~v2.123',
          undefined,
          'channel-token',
          comment(),
          channel()
        )
      )
    ).toMatch(/^BadBody: TikTok has not made this post public/);
    expect(calls.some((c) => c.url.includes('/comment/create/'))).toBe(false);
  });

  it('refuses a channel without the second authorization, an empty comment and one over 1,200 characters', async () => {
    const calls = answers(() => ({ code: 0, data: {} }));
    const provider = new TiktokProvider();
    const run = (items: any, integration: any) =>
      outcome(
        provider.comment('i', '7600000000000000001', undefined, 't', items, integration)
      );
    expect(await run(comment(), channel({ customInstanceDetails: null }))).toMatch(
      /^BadBody: First comment is not turned on for this TikTok channel/
    );
    expect(await run(comment('   '), channel())).toBe(
      'BadBody: A TikTok comment needs text.'
    );
    expect(await run(comment('x'.repeat(1201)), channel())).toBe(
      'BadBody: A TikTok comment can have up to 1200 characters.'
    );
    expect(calls).toHaveLength(0);
  });

  it("passes on TikTok's reason when it refuses the comment", async () => {
    answers(() => ({ code: 40001, message: 'video is not owned by the account' }));
    expect(
      await outcome(
        new TiktokProvider().comment(
          'i',
          '7600000000000000001',
          undefined,
          't',
          comment(),
          channel()
        )
      )
    ).toBe(
      'BadBody: TikTok could not publish the comment (video is not owned by the account)'
    );
  });
});

describe('TikTok first comment: keeping the access alive', () => {
  it('renews an access about to run out and answers the value to store', async () => {
    answers(() => ({
      code: 0,
      data: { access_token: 'act.2', refresh_token: 'rft.2', expires_in: 86400 },
    }));
    const stale = channel({
      customInstanceDetails: sealTiktokBusinessAccess({
        ...access,
        accessExpiresAt: Date.now() - 1000,
      }),
    });
    const renewed = await new TiktokProvider().refreshCommentAccess(stale);
    expect(openTiktokBusinessAccess(renewed)).toMatchObject({
      openId: 'open-1',
      accessToken: 'act.2',
      refreshToken: 'rft.2',
    });
  });

  it('leaves a good access, and a channel without one, alone', async () => {
    const calls = answers(() => ({ code: 0, data: {} }));
    const provider = new TiktokProvider();
    expect(await provider.refreshCommentAccess(channel())).toBeUndefined();
    expect(
      await provider.refreshCommentAccess(channel({ customInstanceDetails: null }))
    ).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
