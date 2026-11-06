import { FacebookProvider } from './facebook.provider';
import { InstagramProvider } from './instagram.provider';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';

// The mobile app signs a user in through the installed Facebook app (Facebook
// Login SDK) and sends us the user token it got, in place of an OAuth code.
// The token comes from the phone, so the provider has to prove with
// debug_token that Meta issued it for our app, to a user, and that it is
// still valid, before it exchanges it for a long-lived one.

const APP_ID = '111222333';
const SDK_TOKEN = 'EAAB' + 'x'.repeat(200);
const USER = '10001';

type Debug = Partial<{
  is_valid: boolean;
  app_id: string;
  type: string;
  user_id: string;
}>;

const graph = (debug: Debug | null, me: { id: string } = { id: USER }) => {
  const calls: string[] = [];
  const json = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as unknown as Response;
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/debug_token')) {
      return debug ? json({ data: debug }) : json({ error: {} }, false);
    }
    if (url.includes('grant_type=fb_exchange_token')) {
      return json({ access_token: 'LONG' });
    }
    if (url.includes('/me/permissions')) {
      const all = [
        ...new FacebookProvider().scopes,
        ...new InstagramProvider().scopes,
      ];
      return json({
        data: all.map((permission) => ({ permission, status: 'granted' })),
      });
    }
    if (url.includes('/me?')) {
      return json({ ...me, name: 'Kris', picture: { data: { url: 'p' } } });
    }
    throw new Error(`unexpected ${url}`);
  }) as any;
  return calls;
};

const valid: Debug = {
  is_valid: true,
  app_id: APP_ID,
  type: 'USER',
  user_id: USER,
};

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => 'accepted',
    (e) => (e instanceof NotEnoughScopes ? e.message : `other: ${e}`)
  );

describe.each([
  ['facebook', () => new FacebookProvider()],
  ['instagram', () => new InstagramProvider()],
])('%s authenticateSdkToken', (_name, make) => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.FACEBOOK_APP_ID = APP_ID;
    process.env.FACEBOOK_APP_SECRET = 'secret';
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('connects with a token Meta issued for our app', async () => {
    const calls = graph(valid);
    const details = await make().authenticateSdkToken(SDK_TOKEN);

    expect(details.id).toBe(USER);
    // The long-lived token is stored, never the short one from the phone.
    expect(details.accessToken).toBe('LONG');
    const debug = calls.find((u) => u.includes('/debug_token'))!;
    expect(debug).toContain(`input_token=${SDK_TOKEN}`);
    expect(debug).toContain(`access_token=${encodeURIComponent(`${APP_ID}|secret`)}`);
    expect(
      calls.find((u) => u.includes('fb_exchange_token'))
    ).toContain(`fb_exchange_token=${SDK_TOKEN}`);
  });

  it.each<[string, Debug | null]>([
    ['issued for another Meta app', { ...valid, app_id: '999' }],
    ['expired or revoked', { ...valid, is_valid: false }],
    ['a Page token', { ...valid, type: 'PAGE' }],
    ['an app token without a user', { ...valid, user_id: undefined }],
    ['refused by debug_token', null],
  ])('⛔ refuses a token %s, before exchanging it', async (_case, debug) => {
    const calls = graph(debug);
    expect(await rejection(make().authenticateSdkToken(SDK_TOKEN))).toBe(
      'This Facebook sign-in was not issued for Postra. Please try again.'
    );
    expect(calls.some((u) => u.includes('fb_exchange_token'))).toBe(false);
  });

  it('⛔ refuses a token whose user is not the one debug_token named', async () => {
    graph(valid, { id: '20002' });
    expect(await rejection(make().authenticateSdkToken(SDK_TOKEN))).toBe(
      'This Facebook sign-in was not issued for Postra. Please try again.'
    );
  });

  it.each(['', 'short', 'EAAB&access_token=other', 'x'.repeat(1100)])(
    '⛔ refuses a malformed token without calling Meta (%#)',
    async (token) => {
      const calls = graph(valid);
      expect(await rejection(make().authenticateSdkToken(token))).toBe(
        'This Facebook sign-in is not valid.'
      );
      expect(calls).toEqual([]);
    }
  );
});
