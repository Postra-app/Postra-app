import { TiktokProvider } from './tiktok.provider';

// A refused refresh (revoked, expired or already used refresh token) answers
// with an error and no tokens. The provider then read `data.user` of the
// user-info call made with an undefined token and failed with "Cannot read
// properties of undefined (reading 'avatar_url')", so the log never said why
// the channel needed reconnecting.

const json = (body: unknown) => ({ json: async () => body }) as unknown as Response;
const realFetch = global.fetch;
afterEach(() => (global.fetch = realFetch));

const answer = (token: unknown, info: unknown) => {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: any) => {
    calls.push(String(url));
    return String(url).includes('/oauth/token/') ? json(token) : json(info);
  }) as any;
  return calls;
};

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => `${e.constructor.name}: ${e.message}`
  );

describe('TikTok refreshToken', () => {
  it('names TikTok\'s error when it refuses the refresh token, without asking for the user', async () => {
    const calls = answer(
      { error: 'invalid_grant', error_description: 'Refresh token is invalid', log_id: 'x' },
      {}
    );
    expect(await outcome(new TiktokProvider().refreshToken('rt'))).toBe(
      'Error: TikTok refused the refresh token (invalid_grant)'
    );
    expect(calls.some((u) => u.includes('/user/info/'))).toBe(false);
  });

  it('says so when the account does not come back', async () => {
    answer(
      { access_token: 'at', refresh_token: 'rt2' },
      { data: {}, error: { code: 'access_token_invalid' } }
    );
    expect(await outcome(new TiktokProvider().refreshToken('rt'))).toBe(
      'Error: TikTok did not return the account after a refresh (access_token_invalid)'
    );
  });

  it('returns the new tokens and the account', async () => {
    answer(
      { access_token: 'at', refresh_token: 'rt2' },
      {
        data: {
          user: { open_id: '-abc-1', display_name: 'Postra', avatar_url: 'p', username: 'postra' },
        },
        error: { code: 'ok' },
      }
    );
    const details = await new TiktokProvider().refreshToken('rt');
    expect(details).toMatchObject({
      accessToken: 'at',
      refreshToken: 'rt2',
      id: 'abc1',
      name: 'Postra',
      username: 'postra',
    });
  });
});

// The stored expiry was a fixed 23 hours whatever TikTok answered. Analytics
// refresh by the stored expiry only, so a shorter lifetime on TikTok's side
// would leave them reading with a dead token (upstream #2429).
describe('TikTok access token lifetime', () => {
  const user = { data: { user: { open_id: 'abc', display_name: 'Postra', avatar_url: 'p', username: 'postra' } } };
  const refreshed = async (expires_in?: unknown) => {
    answer({ access_token: 'at', refresh_token: 'rt2', expires_in }, user);
    return (await new TiktokProvider().refreshToken('rt')).expiresIn;
  };

  it('follows a shorter lifetime TikTok reports', async () => {
    expect(await refreshed(7200)).toBe(7200);
  });

  it("stays at 23 hours for today's 24-hour answer, and when TikTok says nothing", async () => {
    expect(await refreshed(86400)).toBe(23 * 3600);
    expect(await refreshed()).toBe(23 * 3600);
    expect(await refreshed('soon')).toBe(23 * 3600);
  });
});
