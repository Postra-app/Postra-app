import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthService } from './auth.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

const GOOGLE_USER = { id: 'google-sub-1', email: 'g@example.com' };

function setup(opts: {
  verified?: { id: string; email: string } | false;
  user?: any;
  passwordUser?: any;
}) {
  const users = {
    getUserByProvider: jest.fn(async () => opts.user ?? null),
    getUserByEmail: jest.fn(async () => opts.passwordUser ?? null),
  };
  const orgs = { createOrgAndUser: jest.fn() };
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

  // The app makes no accounts, and sign-ups may be frozen.
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
      passwordUser: { id: 'u9', providerName: 'LOCAL' },
    });

    await expect(service.googleNativeLogin('id-token')).resolves.toEqual({
      error: 'password_account',
    });
    expect(users.getUserByEmail).toHaveBeenCalledWith('g@example.com');
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
});
