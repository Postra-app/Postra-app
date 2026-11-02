jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const counters = new Map<string, number>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async (k: string) => (counters.has(k) ? String(counters.get(k)) : null)),
    incr: jest.fn(async (k: string) => {
      counters.set(k, (counters.get(k) || 0) + 1);
      return counters.get(k);
    }),
    expire: jest.fn(async () => 1),
    del: jest.fn(async (k: string) => counters.delete(k)),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require('./auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService: AuthChecker } = require('@gitroom/helpers/auth/auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Provider } = require('@prisma/client');

// §60 C2 (contract tests): the per-address lockout that stops password
// guessing spread over many IPs (the route's own throttle is per IP) had no
// test. Ten wrong passwords lock the address for the window, the right
// password included; a success clears the count.
describe('login lockout', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  });
  beforeEach(() => counters.clear());

  const service = () => {
    const s = Object.create(AuthService.prototype);
    Object.assign(s, {
      _userService: {
        getUserByEmail: async () => ({
          id: 'u1',
          email: 'owner@example.com',
          activated: true,
          password: AuthChecker.hashPassword('right-password'),
          tokenVersion: 0,
        }),
      },
      jwt: async () => 'jwt',
    });
    return s;
  };
  const login = (s: unknown, password: string) =>
    (s as { routeAuth: (...a: unknown[]) => Promise<unknown> }).routeAuth(
      Provider.LOCAL,
      { email: 'Owner@Example.com', password },
      '203.0.113.1',
      'jest'
    );

  it('locks the address after ten wrong passwords, the right one too', async () => {
    const s = service();
    for (let i = 0; i < 10; i++) {
      await expect(login(s, 'wrong')).rejects.toThrow('Invalid user name or password');
    }
    await expect(login(s, 'right-password')).rejects.toThrow(/Too many failed login attempts/);
  });

  it('a successful login clears the count', async () => {
    const s = service();
    for (let i = 0; i < 9; i++) {
      await expect(login(s, 'wrong')).rejects.toThrow('Invalid user name or password');
    }
    await expect(login(s, 'right-password')).resolves.toEqual({ addedOrg: false, jwt: 'jwt' });
    await expect(login(s, 'wrong')).rejects.toThrow('Invalid user name or password');
  });
});
