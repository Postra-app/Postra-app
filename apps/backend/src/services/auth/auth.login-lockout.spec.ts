// A module, so its require() bindings do not collide with other specs.
export {};
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const counters = new Map<string, number>();
const expiring = new Set<string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async (k: string) => (counters.has(k) ? String(counters.get(k)) : null)),
    incr: jest.fn(async (k: string) => {
      counters.set(k, (counters.get(k) || 0) + 1);
      return counters.get(k);
    }),
    expire: jest.fn(async (k: string) => {
      expiring.add(k);
      return 1;
    }),
    ttl: jest.fn(async (k: string) => (!counters.has(k) ? -2 : expiring.has(k) ? 600 : -1)),
    del: jest.fn(async (k: string) => {
      expiring.delete(k);
      return counters.delete(k);
    }),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require('./auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService: AuthChecker } = require('@gitroom/helpers/auth/auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Provider } = require('@prisma/client');

// The per-address lockout that stops password
// guessing spread over many IPs (the route's own throttle is per IP) had no
// test. Ten wrong passwords lock the address for the window, the right
// password included; a success clears the count.
describe('login lockout', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  });
  beforeEach(() => {
    counters.clear();
    expiring.clear();
  });

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

  // An increment can reach Redis while its answer is lost (a timeout): the
  // count is then 1 with no expiry, and nothing ever set one afterwards.
  it('a count left without an expiry gets one at the next failure, so the lock ends', async () => {
    counters.set('login_failures:owner@example.com', 1);
    const s = service();

    await expect(login(s, 'wrong')).rejects.toThrow('Invalid user name or password');

    expect(expiring.has('login_failures:owner@example.com')).toBe(true);
  });

  it('a successful login clears the count', async () => {
    const s = service();
    for (let i = 0; i < 9; i++) {
      await expect(login(s, 'wrong')).rejects.toThrow('Invalid user name or password');
    }
    await expect(login(s, 'right-password')).resolves.toEqual({ addedOrg: false, jwt: 'jwt', userId: 'u1' });
    await expect(login(s, 'wrong')).rejects.toThrow('Invalid user name or password');
  });
});
