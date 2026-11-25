import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuthService } from './auth.service';

// Someone whose account was made with a password presses "Continue with
// Google". That is not the Google account, so nobody is signed in; the page
// used to answer with the sign-up form and no word of why, and sending it
// ended in "This email is already taken". The answer now says the address has
// a password account, and a new person gets the address back to be shown
// which Google account they are finishing sign-up with.
const service = (existing: object | null, google: object) => {
  const s = Object.create(AuthService.prototype);
  Object.assign(s, {
    _userService: {
      getUserByProvider: async (): Promise<null> => null,
      getUserByEmail: async (email: string) =>
        email === 'owner@example.com' ? existing : null,
    },
    _providerManager: {
      getProvider: () => ({
        getToken: async () => 'access',
        getUser: async () => google,
      }),
    },
    canRegister: async () => true,
  });
  return s;
};

describe('coming back from Google without a Google account in Postra', () => {
  const redis = ioRedis as any;
  const original = redis.getdel;
  beforeEach(() => {
    redis.getdel = async (key: string) => (key.startsWith('auth-state:') ? 'nonce' : null);
  });
  afterAll(() => {
    redis.getdel = original;
  });
  const check = (s: any) => s.checkExists('GOOGLE', 'code', undefined, 'state', 'nonce');

  it('says so when the address has an account with a password', async () => {
    const s = service({ id: 'u-1' }, { id: 'g-1', email: 'Owner@Example.com', verified: true });
    expect(await check(s)).toEqual({ passwordAccount: true });
  });

  it('gives a new person the sign-up token and the address they signed in with', async () => {
    const s = service(null, { id: 'g-2', email: 'new@example.com', verified: true });
    expect(await check(s)).toMatchObject({ token: 'access', canRegister: true, email: 'new@example.com' });
  });

  it('an address Google has not verified proves nothing: no lookup, no address back', async () => {
    const s = service({ id: 'u-1' }, { id: 'g-3', email: 'owner@example.com', verified: false });
    const answer = await check(s);
    expect(answer.passwordAccount).toBeUndefined();
    expect(answer.email).toBeUndefined();
    expect(answer.token).toBe('access');
  });
});
