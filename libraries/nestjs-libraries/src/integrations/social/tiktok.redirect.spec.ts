import {
  TiktokProvider,
  tiktokRedirectUri,
} from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';

// The TikTok app is live with one registered redirect URI, and any change to
// it is a revision TikTok reviews again (weeks, four rejections before the
// approval). When the app moved to app.postra.co.uk (D21), TikTok kept
// app.postra.pl through TIKTOK_URL: the old host answers with a 301 to the new
// one, path and query kept. Authorize and token exchange must send the same
// address, or TikTok refuses the code.
describe('tiktokRedirectUri', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
  });

  it('follows FRONTEND_URL when TIKTOK_URL is not set', () => {
    process.env = { ...env, FRONTEND_URL: 'https://app.postra.co.uk' };
    delete process.env.TIKTOK_URL;
    expect(tiktokRedirectUri()).toBe('https://app.postra.co.uk/integrations/social/tiktok');
  });

  it('uses TIKTOK_URL when set', () => {
    process.env = {
      ...env,
      FRONTEND_URL: 'https://app.postra.co.uk',
      TIKTOK_URL: 'https://app.postra.pl',
    };
    expect(tiktokRedirectUri()).toBe('https://app.postra.pl/integrations/social/tiktok');
  });

  it('sends the same address to authorize and to the token exchange', async () => {
    process.env = {
      ...env,
      FRONTEND_URL: 'https://app.postra.co.uk',
      TIKTOK_URL: 'https://app.postra.pl',
      TIKTOK_CLIENT_ID: 'ck',
      TIKTOK_CLIENT_SECRET: 'cs',
    };
    const provider = new TiktokProvider();
    const { url } = await provider.generateAuthUrl();
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      'https://app.postra.pl/integrations/social/tiktok'
    );

    const bodies: string[] = [];
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (_input: any, init?: any) => {
        bodies.push(String(init?.body ?? ''));
        throw new Error('stop after the token request');
      });
    await expect(
      provider.authenticate({ code: 'c', codeVerifier: 'v' })
    ).rejects.toThrow('stop after the token request');
    fetchSpy.mockRestore();
    expect(new URLSearchParams(bodies[0]).get('redirect_uri')).toBe(
      'https://app.postra.pl/integrations/social/tiktok'
    );
  });
});
