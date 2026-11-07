jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
const fetchMediaStream = jest.fn(async () => {
  throw new Error('stop after picking the file');
});
jest.mock('@gitroom/nestjs-libraries/media/fetch.media.buffer', () => ({ fetchMediaStream }));

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PinterestProvider, pinterestApi } from './pinterest.provider';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { PinterestSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';

// Pinterest fixes from upstream (002a341b, 538f3e6f, 8f92a37e, cd899eaa).
describe('Pinterest', () => {
  const provider = new PinterestProvider();

  it('a board name instead of the id is explained, however the pattern is escaped', () => {
    for (const body of [
      `{"message":"board_id does not match '^\\\\d+$'"}`,
      `{"message":"board_id does not match '^\\\\\\\\d+$'"}`,
    ]) {
      expect(provider.handleErrors(body)?.value).toContain('numeric');
    }
  });

  it('a board the account cannot post to is explained', () => {
    expect(
      provider.handleErrors('{"message":"You are not permitted to access that resource."}')?.value
    ).toContain('not permitted to post to this board');
  });

  it('the composer refuses a board name before the post is queued', async () => {
    const errors = (dto: object) => validate(plainToInstance(PinterestSettingsDto, dto));
    expect(await errors({ board: '1234567890' })).toHaveLength(0);
    const [named] = await errors({ board: 'Wedding ideas' });
    expect(Object.values(named.constraints!)).toContain(
      'Board must be the numeric board id (use the boards list of the channel to find it), not the board name'
    );
  });

  it('pin analytics come from summary_metrics', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        all: {
          summary_metrics: { IMPRESSION: 120, PIN_CLICK: 7, OUTBOUND_CLICK: 3, SAVE: 2 },
          lifetime_metrics: { TOTAL_COMMENTS: 1 },
        },
      }),
    } as any);
    const result = await provider.postAnalytics('ig', 'token', 'pin-1', 30);
    fetchSpy.mockRestore();
    expect(result.map((r) => [r.label, r.data[0].total])).toEqual([
      ['Impressions', '120'],
      ['Pin Clicks', '7'],
      ['Outbound Clicks', '3'],
      ['Saves', '2'],
    ]);
  });

  it('a video pin uploads the video, not the cover that came first (upstream be413ec2)', async () => {
    (provider as any).fetch = async () => ({
      json: async () => ({ upload_url: 'https://upload', media_id: 'm1', upload_parameters: {} }),
    });
    const media = [
      { path: 'https://cdn-dev.postra.pl/cover.jpg' },
      { path: 'https://cdn-dev.postra.pl/clip.mp4' },
    ];
    await provider
      .post('pin-user', 'token', [{ id: 'p1', message: 'x', settings: { board: '123' }, media }] as any)
      .catch(() => undefined);
    expect(fetchMediaStream).toHaveBeenCalledWith('https://cdn-dev.postra.pl/clip.mp4');
  });
});

// Pinterest code 2787 ("Something went wrong on our end") is transient on
// their side; the post failed at once instead of being retried (upstream
// 18a312b6b).
describe('PinterestProvider.handleErrors: transient 2787', () => {
  it('retries', () => {
    const res = new PinterestProvider().handleErrors(
      JSON.stringify({ code: 2787, message: 'Something went wrong on our end. Sorry about that.' })
    );
    expect(res?.type).toBe('retry');
  });
});

// Trial apps may create Pins only on api-sandbox.pinterest.com, and the
// sandbox accepts only a token from its own oauth/token: PINTEREST_API_BASE
// moves every API call, the token exchange included (2026-10-26).
describe('Pinterest API base', () => {
  const original = process.env.PINTEREST_API_BASE;
  afterEach(() => {
    if (original === undefined) delete process.env.PINTEREST_API_BASE;
    else process.env.PINTEREST_API_BASE = original;
    jest.restoreAllMocks();
  });

  const reply = (body: object) =>
    ({ ok: true, status: 200, json: async () => body } as any);

  it('defaults to the production API', () => {
    delete process.env.PINTEREST_API_BASE;
    expect(pinterestApi('/pins')).toBe('https://api.pinterest.com/v5/pins');
  });

  it('the sandbox takes the code exchange, the profile and the boards; the consent screen stays on pinterest.com', async () => {
    process.env.PINTEREST_API_BASE = 'https://api-sandbox.pinterest.com/';
    const urls: string[] = [];
    jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any) => {
      urls.push(String(url));
      return reply({
        access_token: 't',
        refresh_token: 'r',
        expires_in: 1,
        scope: 'boards:read,boards:write,pins:read,pins:write,user_accounts:read',
        id: 'u1',
        username: 'postra',
        items: [{ id: '1', name: 'Postra' }],
      });
    });
    const provider = new PinterestProvider();
    expect((await provider.generateAuthUrl()).url).toMatch(/^https:\/\/www\.pinterest\.com\/oauth\//);
    await provider.authenticate({ code: 'c', codeVerifier: 'v', refresh: '' });
    await provider.boards('t');
    expect(urls).toEqual([
      'https://api-sandbox.pinterest.com/v5/oauth/token',
      'https://api-sandbox.pinterest.com/v5/user_account',
      'https://api-sandbox.pinterest.com/v5/boards?page_size=250',
    ]);
  });

  it('boards follow the bookmark past an empty page', async () => {
    delete process.env.PINTEREST_API_BASE;
    const pages = [
      { items: [], bookmark: 'b1' },
      { items: [{ id: '42', name: 'Postra' }], bookmark: null },
    ];
    const fetchSpy = jest
      .spyOn(global, 'fetch' as any)
      .mockImplementation(async () => reply(pages.shift()!));
    expect(await new PinterestProvider().boards('t')).toEqual([{ id: '42', name: 'Postra' }]);
    expect(String(fetchSpy.mock.calls[1][0])).toBe(
      'https://api.pinterest.com/v5/boards?page_size=250&bookmark=b1'
    );
  });

  // An error answer has no items: it read as an account without boards
  // ("No boards found") and left nothing in the logs.
  it('a refused board list is logged with Pinterest\'s code and not passed off as no boards', async () => {
    delete process.env.PINTEREST_API_BASE;
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ code: 29, message: 'You are not permitted to access that resource.' }),
    } as any);
    await expect(new PinterestProvider().boards('secret-token')).rejects.toThrow('Pinterest boards 403');
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain('[pinterest] boards 403 code=29');
    expect(line).not.toContain('secret-token');
  });

  it('an expired token on the board list asks for a refresh', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 2, message: 'Authentication failed.' }),
    } as any);
    await expect(new PinterestProvider().boards('t')).rejects.toBeInstanceOf(RefreshToken);
  });

  it('account analytics without data (an error body, or the sandbox) is empty, not a crash', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue(reply({ code: 3, message: 'no' }));
    const result = await new PinterestProvider().analytics('u1', 't', 30);
    expect(result.map((r) => r.data.length)).toEqual([0, 0, 0, 0, 0]);
  });

});

describe('Pinterest personal accounts', () => {
  const provider = new PinterestProvider();

  // Pinterest's policy since 14 Sep 2026: an app registered after it reads
  // boards only on Business accounts. A personal account connected fine and
  // then could never pick a board (403, code 6410).
  describe('connecting', () => {
    const answer = (body: object) => ({ ok: true, status: 200, json: async () => body });
    const connect = (accountType?: string) => {
      jest
        .spyOn(global, 'fetch' as any)
        .mockResolvedValueOnce(
          answer({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: provider.scopes.join(',') })
        )
        .mockResolvedValueOnce(
          answer({ id: 'u1', username: 'maker', profile_image: 'p', ...(accountType ? { account_type: accountType } : {}) })
        );
      return provider.authenticate({ code: 'c', codeVerifier: 'v', refresh: '' });
    };
    afterEach(() => jest.restoreAllMocks());

    it('a personal account is refused with what to do', async () => {
      expect(await connect('PINNER')).toBe(
        'Pinterest only lets apps use boards on Business accounts. Switch to a free Business account in Pinterest settings, then connect again.'
      );
    });

    it('a Business account connects', async () => {
      expect(await connect('BUSINESS')).toMatchObject({ id: 'u1', name: 'maker', accessToken: 'a' });
    });

    it('an answer without the account type is not refused', async () => {
      expect(await connect()).toMatchObject({ id: 'u1' });
    });
  });

  it('the boards list explains a personal account', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ code: 6410, message: 'Your application does not have access to read pinner data.' }),
    });
    await expect(provider.boards('t')).rejects.toThrow(/Business accounts/);
    jest.restoreAllMocks();
  });
});
