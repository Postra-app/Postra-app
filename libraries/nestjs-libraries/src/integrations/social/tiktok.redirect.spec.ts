import {
  TiktokProvider,
  tiktokRedirectUri,
} from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { tiktokBusinessRedirectUri } from '@gitroom/nestjs-libraries/integrations/social/tiktok.business';

// TikTok refuses a sign-in whose redirect URI is not the one registered for
// the app ("redirect_uri"). The channel's is on the app's own host, so it
// follows FRONTEND_URL even when TIKTOK_URL is set: that variable belongs to
// the TikTok API for Business app (first comments), registered on another
// host. Authorize and token exchange must send the same address, or TikTok
// refuses the code.
describe('tiktokRedirectUri', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
  });

  it('follows FRONTEND_URL', () => {
    process.env = { ...env, FRONTEND_URL: 'https://app.example.test' };
    delete process.env.TIKTOK_URL;
    expect(tiktokRedirectUri()).toBe('https://app.example.test/integrations/social/tiktok');
  });

  it('ignores TIKTOK_URL, which only the Business app uses', () => {
    process.env = {
      ...env,
      FRONTEND_URL: 'https://app.example.test',
      TIKTOK_URL: 'https://old.example.test',
    };
    expect(tiktokRedirectUri()).toBe('https://app.example.test/integrations/social/tiktok');
    expect(tiktokBusinessRedirectUri()).toBe(
      'https://old.example.test/integrations/social/tiktok-business'
    );
  });

  it('sends the same address to authorize and to the token exchange', async () => {
    process.env = {
      ...env,
      FRONTEND_URL: 'https://app.example.test',
      TIKTOK_URL: 'https://old.example.test',
      TIKTOK_CLIENT_ID: 'ck',
      TIKTOK_CLIENT_SECRET: 'cs',
    };
    const provider = new TiktokProvider();
    const { url } = await provider.generateAuthUrl();
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(
      'https://app.example.test/integrations/social/tiktok'
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
      'https://app.example.test/integrations/social/tiktok'
    );
  });
});
