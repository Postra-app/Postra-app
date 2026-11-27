import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthService } from './auth.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

const GOOGLE_USER = { id: 'google-sub-1', email: 'g@example.com' };
const SIGN_UP = {
  company: 'Lato Zima Studio',
  platform: 'ios' as const,
  ip: '1.2.3.4',
  userAgent: 'Postra/1.0.7',
};

function setup(opts: {
  verified?: { id: string; email: string } | false;
  user?: any;
  otherProvider?: 'LOCAL' | 'GOOGLE' | 'APPLE' | null;
  registration?: 'open' | 'closed';
}) {
  process.env.DISABLE_REGISTRATION =
    opts.registration === 'closed' ? 'true' : 'false';
  const users = {
    getUserByProvider: jest.fn(async () => opts.user ?? null),
    getOtherAccountProvider: jest.fn(async () => opts.otherProvider ?? null),
  };
  const orgs = {
    getCount: jest.fn(async () => 5),
    createOrgAndUser: jest.fn(async (body: any) => ({
      id: 'org-new',
      users: [
        {
          user: {
            id: 'user-new',
            email: body.email,
            tokenVersion: 0,
            suspendedAt: null as Date | null,
          },
        },
      ],
    })),
  };
  const verifyIdToken = jest.fn(async () => opts.verified ?? false);
  const providers = { getProvider: jest.fn(() => ({ verifyIdToken })) };
  const service = new AuthService(
    users as any,
    orgs as any,
    {} as any,
    {} as any,
    providers as any
  );
  return { service, users, orgs, verifyIdToken, providers };
}

describe('Google sign-in from the mobile app', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('signs in the account that was made with that Google account', async () => {
    const user = { id: 'u1', email: 'g@example.com', tokenVersion: 2, suspendedAt: null as Date | null };
    const { service, users, providers } = setup({ verified: GOOGLE_USER, user });

    const result = await service.googleNativeLogin('id-token');

    expect(providers.getProvider).toHaveBeenCalledWith('GOOGLE');
    expect(users.getUserByProvider).toHaveBeenCalledWith('google-sub-1', 'GOOGLE');
    expect('jwt' in result).toBe(true);
    const payload = AuthChecker.verifyJWT((result as any).jwt) as any;
    expect(payload.id).toBe('u1');
    expect(payload.tokenVersion).toBe(2);
  });

  // Without `create` (Android, older iOS builds) the app makes no accounts.
  it('makes no account for a Google account Postra does not know', async () => {
    const { service, orgs } = setup({ verified: GOOGLE_USER, user: null });

    await expect(service.googleNativeLogin('id-token')).resolves.toEqual({
      error: 'no_account',
    });
    expect(orgs.createOrgAndUser).not.toHaveBeenCalled();
  });

  // "No account" sent people who signed up with a password to sign up again.
  it('says the address has a password account, and still signs nobody in', async () => {
    const { service, users, orgs } = setup({
      verified: { id: 'google-sub-1', email: 'G@Example.com' },
      user: null,
      otherProvider: 'LOCAL',
    });

    await expect(
      service.googleNativeLogin('id-token', SIGN_UP)
    ).resolves.toEqual({
      error: 'password_account',
    });
    expect(users.getOtherAccountProvider).toHaveBeenCalledWith(
      'g@example.com',
      'GOOGLE'
    );
    expect(orgs.createOrgAndUser).not.toHaveBeenCalled();
  });

  it('looks nobody up for a token Google did not vouch for', async () => {
    const { service, users } = setup({ verified: false });

    await expect(service.googleNativeLogin('forged')).resolves.toEqual({
      error: 'invalid',
    });
    expect(users.getUserByProvider).not.toHaveBeenCalled();
  });

  it('gives a suspended account no session', async () => {
    const user = { id: 'u1', email: 'g@example.com', tokenVersion: 0, suspendedAt: new Date() };
    const { service } = setup({ verified: GOOGLE_USER, user });

    await expect(service.googleNativeLogin('id-token')).rejects.toThrow(/suspended/);
  });

  // The iOS app's sign-up: the account the web sign-up would make.
  it('makes the account when the app asks for it, with the consent and the workspace name', async () => {
    const { service, orgs } = setup({ verified: GOOGLE_USER, user: null });

    const result = await service.googleNativeLogin('id-token', SIGN_UP);

    expect(orgs.createOrgAndUser).toHaveBeenCalledWith(
      expect.objectContaining({
        company: 'Lato Zima Studio',
        email: 'g@example.com',
        provider: 'GOOGLE',
        providerId: 'google-sub-1',
        termsAccepted: true,
        region: 'UK',
        signupSource: 'app',
        signupMedium: 'ios',
      }),
      '1.2.3.4',
      'Postra/1.0.7'
    );
    expect(result).toEqual(
      expect.objectContaining({ created: true, user: expect.objectContaining({ id: 'user-new' }) })
    );
    expect((AuthChecker.verifyJWT((result as any).jwt) as any).id).toBe('user-new');
  });

  it('makes no second account for an address that signs in with another provider', async () => {
    const { service, orgs } = setup({
      verified: GOOGLE_USER,
      user: null,
      otherProvider: 'APPLE',
    });

    await expect(
      service.googleNativeLogin('id-token', SIGN_UP)
    ).resolves.toEqual({ error: 'other_account', provider: 'APPLE' });
    expect(orgs.createOrgAndUser).not.toHaveBeenCalled();
  });

  it('keeps to the sign-up freeze: no account while sign-ups are closed', async () => {
    const { service, orgs } = setup({
      verified: GOOGLE_USER,
      user: null,
      registration: 'closed',
    });

    await expect(
      service.googleNativeLogin('id-token', SIGN_UP)
    ).resolves.toEqual({ error: 'closed' });
    expect(orgs.createOrgAndUser).not.toHaveBeenCalled();
  });
});
