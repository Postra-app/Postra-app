import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuthService } from './auth.service';

// While sign-ups are closed (before launch), people an admin promised a
// plan to must still be able to sign up - by password or with Google - and
// nobody else. An address Google has not verified is not proof of owning
// it, so it neither opens the door nor claims the plan.

const PROMISED = 'creator@example.com';

const service = (overrides: Record<string, unknown> = {}) => {
  const s = Object.create(AuthService.prototype);
  const created: string[] = [];
  const applied: Array<[string, string | null | undefined]> = [];
  Object.assign(s, {
    _organizationService: {
      getCount: async () => 4,
      createOrgAndUser: async (body: { email: string }) => {
        created.push(body.email);
        return { id: 'org-new', users: [{ user: { id: 'user-new' } }] };
      },
    },
    _subscriptionService: {
      hasPendingGrant: async (email?: string | null) =>
        (email || '').toLowerCase() === PROMISED,
      applyPendingGrant: async (orgId: string, email?: string | null) => {
        applied.push([orgId, email]);
        return true;
      },
    },
    _userService: {
      getUserByEmail: async (): Promise<null> => null,
      getUserByNormalizedEmail: async (): Promise<null> => null,
      getUserByProvider: async (): Promise<null> => null,
    },
    _track: async (): Promise<void> => undefined,
    ...overrides,
  });
  return { s, created, applied };
};

describe('sign-ups closed: only an address with a promised plan gets in', () => {
  const before = process.env.DISABLE_REGISTRATION;
  beforeEach(() => {
    process.env.DISABLE_REGISTRATION = 'true';
  });
  afterAll(() => {
    process.env.DISABLE_REGISTRATION = before;
  });

  it('lets the promised address register and refuses any other', async () => {
    const { s } = service();
    expect(await s.canRegister('LOCAL', PROMISED)).toBe(true);
    expect(await s.canRegister('LOCAL', 'someone@example.com')).toBe(false);
    expect(await s.canRegister('LOCAL')).toBe(false);
    expect(await s.canRegister('GOOGLE', null)).toBe(false);
  });

  it('with sign-ups open, anyone registers as before', async () => {
    process.env.DISABLE_REGISTRATION = 'false';
    const { s } = service();
    expect(await s.canRegister('LOCAL', 'someone@example.com')).toBe(true);
  });

  it('a new Google account: the promised, verified address is let in and gets its plan', async () => {
    const { s, created, applied } = service({
      _providerManager: {
        getProvider: () => ({
          getUser: async () => ({ id: 'g-1', email: PROMISED, verified: true }),
        }),
      },
    });
    await s.loginOrRegisterProvider('GOOGLE', { providerToken: 'tok', company: 'Creator', termsAccepted: true } as any, '1.2.3.4', 'ua');
    expect(created).toEqual([PROMISED]);
    expect(applied).toEqual([['org-new', PROMISED]]);
  });

  it('a Google address that Google has not verified does not open the door', async () => {
    const { s, created, applied } = service({
      _providerManager: {
        getProvider: () => ({
          getUser: async () => ({ id: 'g-2', email: PROMISED, verified: false }),
        }),
      },
    });
    await expect(
      s.loginOrRegisterProvider('GOOGLE', { providerToken: 'tok', company: 'X', termsAccepted: true } as any, '1.2.3.4', 'ua')
    ).rejects.toThrow('Registration is disabled');
    expect(created).toEqual([]);
    expect(applied).toEqual([]);
  });

  it('a provider that does not say the address is verified is not trusted with a promise', async () => {
    const { s, created } = service({
      _providerManager: {
        getProvider: () => ({
          getUser: async () => ({ id: 'gh-1', email: PROMISED }),
        }),
      },
    });
    await expect(
      s.loginOrRegisterProvider('GITHUB', { providerToken: 'tok', company: 'X', termsAccepted: true } as any, '1.2.3.4', 'ua')
    ).rejects.toThrow('Registration is disabled');
    expect(created).toEqual([]);
  });

  it('two sign-ups racing for the same promised address: only one gets in', async () => {
    let waiting = true;
    const created: string[] = [];
    const { s } = service({
      _organizationService: {
        getCount: async () => 4,
        createOrgAndUser: async (body: { email: string }) => {
          await new Promise((r) => setTimeout(r, 50));
          created.push(body.email);
          return { id: `org-${created.length}`, users: [{ user: { id: 'u' } }] };
        },
      },
      _subscriptionService: {
        hasPendingGrant: async (email?: string | null) => waiting && (email || '').toLowerCase() === PROMISED,
        applyPendingGrant: async () => {
          const had = waiting;
          waiting = false;
          return had;
        },
      },
    });
    const viaGoogle = (id: string) => ({
      _providerManager: { getProvider: () => ({ getUser: async () => ({ id, email: PROMISED, verified: true }) }) },
    });
    Object.assign(s, viaGoogle('g-a'));
    const first = s.loginOrRegisterProvider('GOOGLE', { providerToken: 'a', company: 'A', termsAccepted: true } as any, '1.2.3.4', 'ua');
    const second = s.loginOrRegisterProvider('GOOGLE', { providerToken: 'b', company: 'B', termsAccepted: true } as any, '1.2.3.4', 'ua');
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(created).toEqual([PROMISED]);
  });

  it('the sign-up page learns before the form whether a new Google account may be made', async () => {
    const provider = (email: string, verified = true) => ({
      _providerManager: {
        getProvider: () => ({
          getToken: async () => 'access',
          getUser: async () => ({ id: 'g-3', email, verified }),
        }),
      },
    });
    const exists = (s: any) =>
      s.checkExists('google', 'code', undefined, 'state-1', 'nonce-1');
    // The OAuth state is checked first; this test is about what follows.
    const redis = ioRedis as any;
    const original = redis.getdel;
    redis.getdel = async () => 'nonce-1';
    try {
      expect(await exists(service(provider(PROMISED)).s)).toEqual({ token: 'access', canRegister: true });
      expect(await exists(service(provider('other@example.com')).s)).toEqual({ token: 'access', canRegister: false });
      expect(await exists(service(provider(PROMISED, false)).s)).toEqual({ token: 'access', canRegister: false });
    } finally {
      redis.getdel = original;
    }
  });
});

export {};
