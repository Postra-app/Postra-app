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
const redis = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: async (k: string, v: string) => (redis.set(k, v), 'OK'),
    get: async (k: string) => redis.get(k) ?? null,
    del: async (k: string) => (redis.delete(k) ? 1 : 0),
    incr: async (k: string) => {
      const n = Number(redis.get(k) ?? 0) + 1;
      redis.set(k, String(n));
      return n;
    },
    expire: async () => 1,
    ttl: async () => 900,
  },
}));
jest.mock('@gitroom/nestjs-libraries/redis/auth-context.cache', () => ({
  bustAuthContextCache: async (): Promise<void> => undefined,
}));
jest.mock('@gitroom/nestjs-libraries/emails/undeliverable.address', () => ({
  isUndeliverable: async () => false,
  UndeliverableAddressError: class extends Error {},
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService, ACTIVATION_WRONG_PASSWORD, ACTIVATION_LINK_INVALID } = require('./auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService: AuthChecker } = require('@gitroom/helpers/auth/auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CreateOrgUserDto } = require('@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto');

// The activation link proves who owns the address. It does not prove who
// typed the password: anyone can sign up with someone else's address. The
// link signs in the browser the sign-up was made in. Anywhere else nothing is
// written until the person either types the password chosen at sign-up (the
// link and the password together activate and sign in) or chooses a new one
// (the password chosen at sign-up stops working).

const ADDRESS = 'creator@example.com';

const world = () => {
  const users: Record<string, any> = {};
  const sentLinks: string[] = [];
  const s = Object.create(AuthService.prototype);
  Object.assign(s, {
    _organizationService: {
      getCount: async () => 4,
      createOrgAndUser: async (body: { email: string; password: string }) => {
        users[body.email] = {
          id: 'user-new',
          email: body.email,
          password: AuthChecker.hashPassword(body.password),
          activated: false,
          tokenVersion: 0,
          providerName: 'LOCAL',
        };
        return { id: 'org-new', users: [{ user: users[body.email] }] };
      },
      getOrgsByUserId: async (): Promise<unknown[]> => [],
    },
    _subscriptionService: {
      hasPendingGrant: async () => false,
      applyPendingGrant: async () => true,
    },
    _userService: {
      getUserByEmail: async (email: string) => users[email] ?? null,
      getUserById: async (id: string) => Object.values(users).find((u: any) => u.id === id) ?? null,
      getUserByNormalizedEmail: async (): Promise<null> => null,
      activateUser: async (id: string) => {
        const u: any = Object.values(users).find((x: any) => x.id === id);
        u.activated = true;
      },
      activateWithCheckedPassword: async (id: string, hash: string) => {
        const u: any = Object.values(users).find((x: any) => x.id === id);
        if (u.activated || u.password !== hash) return false;
        u.activated = true;
        return true;
      },
      activateWithoutPassword: async (id: string, unusable: string) => {
        const u: any = Object.values(users).find((x: any) => x.id === id);
        if (u.activated) return null;
        u.activated = true;
        u.password = AuthChecker.hashPassword(unusable);
        u.tokenVersion += 1;
        return u.tokenVersion;
      },
      updatePassword: async (id: string, password: string, tokenVersion: number) => {
        const u: any = Object.values(users).find((x: any) => x.id === id);
        if (u.tokenVersion !== tokenVersion) return 0;
        u.password = AuthChecker.hashPassword(password);
        u.tokenVersion += 1;
        return 1;
      },
    },
    _emailService: {
      sendEmailSync: async (_to: string, _subject: string, html: string) => {
        sentLinks.push(/\/auth\/activate\/([\w.-]+)/.exec(html)![1]);
        return true;
      },
    },
    _track: async (): Promise<void> => undefined,
    jwt: async () => 'session',
  });
  const signUp = async (password: string) => {
    const body = Object.assign(new CreateOrgUserDto(), {
      provider: 'LOCAL',
      email: ADDRESS,
      password,
      company: 'Studio',
    });
    const out = await s.routeAuth('LOCAL', body, 'ip', 'ua');
    return { proof: out.registrationProof as string | undefined, link: sentLinks.at(-1)! };
  };
  return { s, users, signUp };
};

describe('activation link and the password the account was made with', () => {
  const before = { ...process.env };
  beforeEach(() => {
    redis.clear();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.FRONTEND_URL = 'https://app.example.com';
    delete process.env.DISABLE_REGISTRATION;
  });
  afterAll(() => {
    process.env = before;
  });

  it('signs in the browser the sign-up was made in, password kept', async () => {
    const { s, users, signUp } = world();
    const { proof, link } = await signUp('Owner-pass-1');

    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    await expect(s.activate(link, '', proof)).resolves.toBe('session');
    expect(users[ADDRESS].activated).toBe(true);
    expect(await AuthChecker.comparePassword('Owner-pass-1', users[ADDRESS].password)).toBe(true);
  });

  it('opened anywhere else: nothing is written, the page asks to sign in', async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Owner-pass-1');

    await expect(s.activate(link, '', undefined)).resolves.toEqual({ signIn: ADDRESS });
    expect(users[ADDRESS].activated).toBe(false);
    expect(users[ADDRESS].tokenVersion).toBe(0);
    expect(await AuthChecker.comparePassword('Owner-pass-1', users[ADDRESS].password)).toBe(true);
  });

  it('the link with the password chosen at sign-up activates and signs in, password kept', async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Owner-pass-1');

    await expect(s.activateWithPassword(link, 'Owner-pass-1', '')).resolves.toBe('session');
    expect(users[ADDRESS].activated).toBe(true);
    expect(await AuthChecker.comparePassword('Owner-pass-1', users[ADDRESS].password)).toBe(true);
  });

  it('a wrong password activates nothing and counts towards the sign-in lockout', async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Owner-pass-1');

    await expect(s.activateWithPassword(link, 'Guess-pass-1', '')).rejects.toThrow(ACTIVATION_WRONG_PASSWORD);
    expect(users[ADDRESS].activated).toBe(false);
    expect(redis.get(`login_failures:${ADDRESS}`)).toBe('1');

    redis.set(`login_failures:${ADDRESS}`, '10');
    await expect(s.activateWithPassword(link, 'Owner-pass-1', '')).rejects.toThrow('Too many failed login attempts');
    expect(users[ADDRESS].activated).toBe(false);
  });

  it('the password alone, without the link, activates nothing', async () => {
    const { s, users, signUp } = world();
    await signUp('Owner-pass-1');

    await expect(s.activateWithPassword('not-a-link', 'Owner-pass-1', '')).rejects.toThrow(ACTIVATION_LINK_INVALID);
    expect(users[ADDRESS].activated).toBe(false);
  });

  it('someone who did not sign up chooses a new password: the one a stranger chose stops working', async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Stranger-pass-1');

    const out = await s.activateAndChoosePassword(link, '');

    expect(out).toEqual({ setPassword: expect.any(String) });
    expect(users[ADDRESS].activated).toBe(true);
    expect(await AuthChecker.comparePassword('Stranger-pass-1', users[ADDRESS].password)).toBe(false);
    // And the stranger's password no longer finishes the activation.
    await expect(s.activateWithPassword(link, 'Stranger-pass-1', '')).resolves.toBe(false);
  });

  it('and the holder of the link chooses their own, once', async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Stranger-pass-1');
    const { setPassword } = (await s.activateAndChoosePassword(link, '')) as { setPassword: string };

    const choose = { token: setPassword, password: 'Owner-pass-2', repeatPassword: 'Owner-pass-2' };
    await expect(s.forgotReturn(choose)).resolves.toBe(true);
    expect(await AuthChecker.comparePassword('Owner-pass-2', users[ADDRESS].password)).toBe(true);
    await expect(s.forgotReturn({ ...choose, password: 'Again-pass-3' })).resolves.toBe(false);
  });

  it('a new password chosen at the same moment wins over the old one being typed', async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Stranger-pass-1');
    const svc = (s as any)._userService;
    const realCheck = svc.activateWithCheckedPassword;
    svc.activateWithCheckedPassword = async (id: string, hash: string) => {
      await s.activateAndChoosePassword(link, '');
      return realCheck(id, hash);
    };

    await expect(s.activateWithPassword(link, 'Stranger-pass-1', '')).rejects.toThrow(ACTIVATION_WRONG_PASSWORD);
    expect(await AuthChecker.comparePassword('Stranger-pass-1', users[ADDRESS].password)).toBe(false);
  });

  it('choosing a new password twice at once, only one gets the link', async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Stranger-pass-1');

    const [first, second] = await Promise.all([
      s.activateAndChoosePassword(link, ''),
      s.activateAndChoosePassword(link, ''),
    ]);

    expect([first, second].filter((r) => r && typeof r === 'object')).toHaveLength(1);
    expect([first, second]).toContain(false);
    expect(users[ADDRESS].tokenVersion).toBe(1);
  });

  it('is active and without the password together, or neither', async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Stranger-pass-1');
    (s as any)._userService.activateWithoutPassword = async () => {
      throw new Error('database gone');
    };

    await expect(s.activateAndChoosePassword(link, '')).rejects.toThrow('database gone');
    expect(users[ADDRESS].activated).toBe(false);
  });

  it("someone else's proof is not this account's", async () => {
    const { s, users, signUp } = world();
    const { link } = await signUp('Stranger-pass-1');

    await expect(s.activate(link, '', 'f'.repeat(64))).resolves.toEqual({ signIn: ADDRESS });
    expect(users[ADDRESS].activated).toBe(false);
  });
});

export {};
