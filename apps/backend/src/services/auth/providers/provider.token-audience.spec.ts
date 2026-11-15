import { google } from 'googleapis';
import { GoogleProvider } from './google.provider';
import { GithubProvider } from './github.provider';

// A sign-in with a provider token is only as good as the proof that the token
// was issued to this app. "Whose token is it" alone let a token the person
// gave to any other site with a Google or GitHub button sign in here as them.

const WEB_CLIENT = 'web-client.apps.googleusercontent.com';

describe('Google access token at sign-in', () => {
  const provider = new GoogleProvider();
  let tokenInfo: jest.SpyInstance;
  let request: jest.SpyInstance;

  beforeEach(() => {
    process.env.YOUTUBE_CLIENT_ID = WEB_CLIENT;
    process.env.FRONTEND_URL = 'https://app.example.com';
    request = (
      jest.spyOn(google.auth.OAuth2.prototype, 'request') as jest.SpyInstance
    ).mockResolvedValue({
        data: { id: '1234567890', email: 'someone@example.com', verified_email: true },
      });
  });
  afterEach(() => {
    tokenInfo?.mockRestore();
    request.mockRestore();
  });

  const issuedTo = (aud: string | undefined) => {
    tokenInfo = jest
      .spyOn(google.auth.OAuth2.prototype, 'getTokenInfo')
      .mockResolvedValue({ aud, scopes: [], expiry_date: Date.now() + 3600e3 } as any);
  };

  it('gives the account of a token issued to this app', async () => {
    issuedTo(WEB_CLIENT);
    await expect(provider.getUser('ya29.ours')).resolves.toEqual({
      id: '1234567890',
      email: 'someone@example.com',
      verified: true,
    });
  });

  it('refuses a token issued to another app, without asking whose it is', async () => {
    issuedTo('someone-else.apps.googleusercontent.com');
    await expect(provider.getUser('ya29.theirs')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a token Google does not know', async () => {
    tokenInfo = jest
      .spyOn(google.auth.OAuth2.prototype, 'getTokenInfo')
      .mockRejectedValue(new Error('invalid_token'));
    await expect(provider.getUser('garbage')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses every token when this app has no client id', async () => {
    delete process.env.YOUTUBE_CLIENT_ID;
    issuedTo(undefined);
    await expect(provider.getUser('ya29.any')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not take an address Google has not said is verified', async () => {
    issuedTo(WEB_CLIENT);
    request.mockResolvedValue({
      data: { id: '1234567890', email: 'someone@example.com' },
    } as any);
    await expect(provider.getUser('ya29.ours')).resolves.toMatchObject({
      verified: false,
    });
  });
});

describe('GitHub access token at sign-in', () => {
  const provider = new GithubProvider();
  const realFetch = global.fetch;
  let calls: string[];

  const answer = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body } as any);

  const github = (tokenCheckStatus: number) => {
    calls = [];
    global.fetch = jest.fn(async (url: any, init?: any) => {
      calls.push(String(url));
      if (String(url).includes('/applications/')) {
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe(
          'Basic ' + Buffer.from('gh-client:gh-secret').toString('base64')
        );
        expect(JSON.parse(init.body)).toEqual({ access_token: 'gho_token' });
        return answer(tokenCheckStatus, {});
      }
      if (String(url).endsWith('/user/emails')) {
        return answer(200, [
          { email: 'someone@example.com', primary: true, verified: true },
        ]);
      }
      return answer(200, { id: 42 });
    }) as any;
  };

  beforeEach(() => {
    process.env.GITHUB_CLIENT_ID = 'gh-client';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('gives the account of a token issued to this app', async () => {
    github(200);
    await expect(provider.getUser('gho_token')).resolves.toEqual({
      id: '42',
      email: 'someone@example.com',
      verified: true,
    });
    expect(calls[0]).toBe('https://api.github.com/applications/gh-client/token');
  });

  it('refuses a token issued to another app, without asking whose it is', async () => {
    github(404);
    await expect(provider.getUser('gho_token')).resolves.toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('refuses every token when this app has no GitHub client', async () => {
    delete process.env.GITHUB_CLIENT_ID;
    github(200);
    await expect(provider.getUser('gho_token')).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });
});
