jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: async () => 'OK', del: async () => 1, get: async (): Promise<null> => null },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService, ACTIVATION_LINK_INVALID } = require('./auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService: AuthChecker } = require('@gitroom/helpers/auth/auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CreateOrgUserDto } = require('@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto');

// A plan promised to an address (influencers before launch) went to the
// first account made with that address by password, before anyone showed
// they own it: whoever knew the address took the plan, and the owner met
// "Email already exists". The promise now waits until the address is proven,
// by the activation link or by a password reset link, both sent to it.

const PROMISED = 'creator@example.com';

const service = (users: Record<string, any> = {}) => {
  const s = Object.create(AuthService.prototype);
  const applied: Array<[string, string]> = [];
  const activated: string[] = [];
  Object.assign(s, {
    _organizationService: {
      getCount: async () => 4,
      createOrgAndUser: async (body: { email: string }) => ({
        id: 'org-new',
        users: [{ user: { id: 'user-new', email: body.email } }],
      }),
      getOrgsByUserId: async (userId: string) => [
        { id: `team-of-${userId}`, users: [{ role: 'USER', disabled: false }] },
        { id: `org-of-${userId}`, users: [{ role: 'SUPERADMIN', disabled: false }] },
      ],
    },
    _subscriptionService: {
      hasPendingGrant: async (email?: string | null) => (email || '').toLowerCase() === PROMISED,
      applyPendingGrant: async (orgId: string, email: string) => {
        applied.push([orgId, email]);
        return true;
      },
    },
    _userService: {
      getUserByEmail: async (email: string) => users[email] ?? null,
      getUserById: async (id: string) => Object.values(users).find((u: any) => u.id === id) ?? null,
      getUserByNormalizedEmail: async (): Promise<null> => null,
      activateUser: async (id: string) => {
        activated.push(id);
        const u: any = Object.values(users).find((x: any) => x.id === id);
        if (u) u.activated = true;
        return u;
      },
      updatePassword: async () => 1,
    },
    _emailService: { sendEmailSync: async () => true, sendEmail: async () => true },
    _track: async (): Promise<void> => undefined,
    jwt: async () => 'session',
  });
  return { s, applied, activated };
};

describe('a promised plan goes to the account only once the address is proven', () => {
  const before = process.env.DISABLE_REGISTRATION;
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.DISABLE_REGISTRATION = 'true';
  });
  afterAll(() => {
    process.env.DISABLE_REGISTRATION = before;
  });

  it('a password sign-up with the promised address does not take the plan yet', async () => {
    const { s, applied } = service();
    const body = Object.assign(new CreateOrgUserDto(), {
      email: PROMISED,
      password: 'long-enough-password',
      company: 'Creator',
      termsAccepted: true,
    });
    await s.routeAuth('LOCAL', body, '1.2.3.4', 'ua');
    expect(applied).toEqual([]);
  });

  it('an instance without email (accounts active from the start) gives the plan at sign-up', async () => {
    const { s, applied } = service();
    s._organizationService.createOrgAndUser = async (body: { email: string }) => ({
      id: 'org-new',
      users: [{ user: { id: 'user-new', email: body.email, activated: true } }],
    });
    const body = Object.assign(new CreateOrgUserDto(), {
      email: PROMISED,
      password: 'long-enough-password',
      company: 'Creator',
      termsAccepted: true,
    });
    await s.routeAuth('LOCAL', body, '1.2.3.4', 'ua');
    expect(applied).toEqual([['org-new', PROMISED]]);
  });

  it('the activation link proves the address and the plan goes to the own organisation', async () => {
    const users = { [PROMISED]: { id: 'u1', email: PROMISED, activated: false } };
    const { s, applied, activated } = service(users);
    const code = AuthChecker.signJWT({ id: 'u1', email: PROMISED, activated: false, purpose: 'activate' });
    await expect(s.activate(code, '')).resolves.toBe('session');
    expect(activated).toEqual(['u1']);
    expect(applied).toEqual([['org-of-u1', PROMISED]]);
  });

  it('an activation link for another account with the same address activates nothing', async () => {
    const users = { [PROMISED]: { id: 'u2', email: PROMISED, activated: false } };
    const { s, applied, activated } = service(users);
    const stale = AuthChecker.signJWT({ id: 'u1', email: PROMISED, activated: false, purpose: 'activate' });
    await expect(s.activate(stale, '')).rejects.toThrow(ACTIVATION_LINK_INVALID);
    expect(activated).toEqual([]);
    expect(applied).toEqual([]);
  });

  it('a reset link on an account nobody activated proves the address: active, with the plan', async () => {
    const users = { [PROMISED]: { id: 'u3', email: PROMISED, activated: false, tokenVersion: 0 } };
    const { s, applied, activated } = service(users);
    const token = AuthChecker.signJWT({
      id: 'u3',
      tokenVersion: 0,
      expires: new Date(Date.now() + 10 * 60000).toISOString(),
      purpose: 'reset',
    });
    await expect(s.forgotReturn({ token, password: 'owner-password-123' })).resolves.toBe(true);
    expect(activated).toEqual(['u3']);
    expect(applied).toEqual([['org-of-u3', PROMISED]]);
  });

  it('a reset on an account that is already active changes only the password', async () => {
    const users = { [PROMISED]: { id: 'u4', email: PROMISED, activated: true, tokenVersion: 0 } };
    const { s, applied, activated } = service(users);
    const token = AuthChecker.signJWT({
      id: 'u4',
      tokenVersion: 0,
      expires: new Date(Date.now() + 10 * 60000).toISOString(),
      purpose: 'reset',
    });
    await expect(s.forgotReturn({ token, password: 'owner-password-123' })).resolves.toBe(true);
    expect(activated).toEqual([]);
    expect(applied).toEqual([]);
  });
});

export {};
