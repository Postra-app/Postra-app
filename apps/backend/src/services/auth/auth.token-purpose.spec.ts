jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(async () => null), incr: jest.fn(async () => 1), expire: jest.fn(async () => 1), del: jest.fn(async () => 1), exists: jest.fn(async () => 0) },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService, ACTIVATION_LINK_INVALID } = require('./auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService: AuthChecker } = require('@gitroom/helpers/auth/auth.service');

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
});

// The reset checked the signature, `expires` and `tokenVersion`,
// not what the token was for. A session token carries the current
// tokenVersion and no `expires`, so the session cookie or the app's token set
// a new password without the old one (local stack, 2026-10-26: 201
// {"reset":true}) and turned a stolen session into a stolen account.
describe('a token does only what it was issued for', () => {
  const resetService = () => {
    const service = Object.create(AuthService.prototype);
    const updatePassword = jest.fn().mockResolvedValue(true);
    Object.assign(service, {
      _userService: { getUserById: async () => ({ id: 'u1', tokenVersion: 3 }), updatePassword },
    });
    return { service, updatePassword };
  };
  const body = (token: string) => ({ token, password: 'new-password-1', repeatPassword: 'new-password-1' });

  it('a session token does not reset the password', async () => {
    const { service, updatePassword } = resetService();
    const session = AuthChecker.signJWT({ id: 'u1', email: 'a@b.co', tokenVersion: 3 });
    await expect(service.forgotReturn(body(session))).resolves.toBe(false);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('a reset link does', async () => {
    const { service, updatePassword } = resetService();
    const reset = AuthChecker.signJWT(
      { id: 'u1', tokenVersion: 3, expires: new Date(Date.now() + 600_000).toISOString(), purpose: 'reset' },
      { expiresIn: '20m' }
    );
    await expect(service.forgotReturn(body(reset))).resolves.toBe(true);
    expect(updatePassword).toHaveBeenCalledWith('u1', 'new-password-1', 3);
  });

  it('a session or reset token is not an activation link', async () => {
    const service = Object.create(AuthService.prototype);
    Object.assign(service, {
      _userService: { getUserByEmail: async () => ({ id: 'u1', email: 'a@b.co', activated: false }), activateUser: jest.fn() },
    });
    for (const token of [
      AuthChecker.signJWT({ id: 'u1', email: 'a@b.co', tokenVersion: 0 }),
      AuthChecker.signJWT({ id: 'u1', email: 'a@b.co', tokenVersion: 0, purpose: 'reset' }),
    ]) {
      await expect(service.activate(token, '')).rejects.toThrow(ACTIVATION_LINK_INVALID);
    }
  });
});

// A wrong password for an existing account took ~55 ms (bcrypt),
// an unknown address ~6 ms, so the time told whether an account existed.
describe('signing in with an unknown address', () => {
  it('compares against a stand-in hash, like a known one', async () => {
    const compare = jest.spyOn(AuthChecker, 'comparePassword');
    const service = Object.create(AuthService.prototype);
    Object.assign(service, {
      _userService: { getUserByEmail: async () => null },
      canRegister: async () => true,
    });
    await expect(
      service.routeAuth('LOCAL', { email: 'nobody@postra.test', password: 'whatever-1', provider: 'LOCAL' }, '1.2.3.4', 'ua')
    ).rejects.toThrow('Invalid user name or password');
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });
});

export {};
