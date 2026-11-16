import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
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

// A workspace owner invites a colleague to the team while sign-ups are
// closed. The colleague has no account yet and was told "Sign-ups are
// closed", so nobody could join a team until launch. The invitation lets in
// the address it was written to, and only that one.
describe('sign-ups closed: an invitation to a team lets its own address in', () => {
  const INVITED = 'colleague@example.com';
  const invite = (email?: string) => ({
    email,
    orgId: 'org-team',
    role: 'USER' as const,
    id: 'inv-1',
  });
  // `null`: a provider that does not say whether the address is verified.
  const google = (email: string, verified: boolean | null = true) => ({
    _providerManager: {
      getProvider: () => ({
        getToken: async () => 'access',
        getUser: async () => ({ id: 'g-team', email, ...(verified === null ? {} : { verified }) }),
      }),
    },
  });
  const signUp = (s: any, withInvite: unknown) =>
    s.loginOrRegisterProvider(
      'GOOGLE',
      { providerToken: 'tok', company: 'Colleague', termsAccepted: true } as any,
      '1.2.3.4',
      'ua',
      withInvite
    );

  const before = process.env.DISABLE_REGISTRATION;
  beforeEach(() => {
    process.env.DISABLE_REGISTRATION = 'true';
  });
  afterAll(() => {
    process.env.DISABLE_REGISTRATION = before;
  });

  it('the invited address may register, by password or with Google', async () => {
    const { s } = service();
    expect(await s.canRegister('LOCAL', INVITED, invite(INVITED))).toBe(true);
    expect(await s.canRegister('GOOGLE', INVITED, invite(INVITED))).toBe(true);
    // The same Gmail mailbox written with dots.
    expect(
      await s.canRegister('GOOGLE', 'colleague.name@gmail.com', invite('colleaguename@gmail.com'))
    ).toBe(true);
  });

  it('another address, a link without an address, or no invitation stays out', async () => {
    const { s } = service();
    expect(await s.canRegister('GOOGLE', 'someone@example.com', invite(INVITED))).toBe(false);
    expect(await s.canRegister('GOOGLE', INVITED, invite())).toBe(false);
    expect(await s.canRegister('GOOGLE', INVITED, false)).toBe(false);
    expect(await s.canRegister('GOOGLE', INVITED)).toBe(false);
    // A +tag is another address, as for a promised plan.
    expect(await s.canRegister('GOOGLE', 'colleague+x@example.com', invite(INVITED))).toBe(false);
  });

  it('a new Google account with the invited, verified address is made', async () => {
    const { s, created, applied } = service(google(INVITED));
    await signUp(s, invite(INVITED));
    expect(created).toEqual([INVITED]);
    // No plan was promised: nothing to claim but the call is harmless.
    expect(applied).toEqual([['org-new', INVITED]]);
  });

  it('an address Google has not verified, or a different one, is refused', async () => {
    for (const provider of [google(INVITED, false), google(INVITED, null), google('someone@example.com')]) {
      const { s, created } = service(provider);
      await expect(signUp(s, invite(INVITED))).rejects.toThrow('Registration is disabled');
      expect(created).toEqual([]);
    }
  });

  it('the sign-up page is told the invited Google address may register', async () => {
    const redis = ioRedis as any;
    const original = redis.getdel;
    redis.getdel = async () => 'nonce-1';
    const exists = (s: any, withInvite?: unknown) =>
      s.checkExists('google', 'code', undefined, 'state-1', 'nonce-1', withInvite);
    try {
      expect(await exists(service(google(INVITED)).s, invite(INVITED))).toEqual({ token: 'access', canRegister: true });
      expect(await exists(service(google(INVITED)).s)).toEqual({ token: 'access', canRegister: false });
      expect(await exists(service(google('someone@example.com')).s, invite(INVITED))).toEqual({ token: 'access', canRegister: false });
    } finally {
      redis.getdel = original;
    }
  });

  it('a password sign-up with the invited address is let in and joins the team', async () => {
    const joined: unknown[][] = [];
    const { s, created } = service({
      _organizationService: {
        getCount: async () => 4,
        createOrgAndUser: async (body: { email: string }) => {
          created.push(body.email);
          return { id: 'org-new', users: [{ user: { id: 'user-new', activated: false } }] };
        },
        addUserToOrg: async (...args: unknown[]) => {
          joined.push(args);
          return { organizationId: 'org-team' };
        },
      },
      _emailService: { sendEmailSync: async (): Promise<void> => undefined },
      jwt: async () => 'jwt',
      rememberWhoRegistered: async () => 'proof',
      activationToken: () => 'token',
    });
    const body = Object.assign(new CreateOrgUserDto(), {
      email: INVITED,
      password: 'long-enough-1',
      company: 'Colleague',
      provider: 'LOCAL',
      termsAccepted: true,
    });
    const other = Object.assign(new CreateOrgUserDto(), { ...body, email: 'someone@example.com' });
    await expect(s.routeAuth('LOCAL', other, '1.2.3.4', 'ua', invite(INVITED))).rejects.toThrow('Registration is disabled');
    const result = await s.routeAuth('LOCAL', body, '1.2.3.4', 'ua', invite(INVITED));
    expect(created).toEqual([INVITED]);
    expect(joined).toEqual([['user-new', 'inv-1', 'org-team', 'USER']]);
    expect(result.addedOrg).toEqual({ organizationId: 'org-team' });
  });
});

export {};
