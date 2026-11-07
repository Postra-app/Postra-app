process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://app.postra.co.uk';
process.env.NOT_SECURED = '';
process.env.ADMIN_TOTP_REQUIRED = 'true';

import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  ADMIN_MFA_MAX_AGE_SECONDS,
  adminMfaFresh,
} from '@gitroom/backend/services/auth/admin-mfa';

// A Postra administrator can act as every customer. With ADMIN_TOTP_REQUIRED
// on, the administrator flag only reaches a request whose session carries a
// fresh second factor (`mfa`); off (the default), the password is enough.

const now = () => Math.floor(Date.now() / 1000);

const admin = {
  id: 'admin-mfa-1',
  email: 'admin@postra.co.uk',
  isSuperAdmin: true,
  activated: true,
  tokenVersion: 1,
  password: 'hash',
};

const customerTarget = {
  user: { id: 'customer-1', email: 'c@example.com', isSuperAdmin: false, activated: true, tokenVersion: 1 },
  organization: { id: 'org-c', apiKey: 'k', users: [{ id: 'uo-c', userId: 'customer-1', disabled: false }] },
};

const build = (user: any = admin) => {
  const organizationService = {
    getUserOrg: jest.fn().mockResolvedValue(customerTarget),
    getOrgsByUserId: jest.fn().mockResolvedValue([
      { id: 'org-1', apiKey: 'key', users: [{ userId: user.id, disabled: false, role: 'SUPERADMIN' }] },
    ]),
    updateApiKey: jest.fn(),
  };
  const userService = {
    getUserById: jest.fn().mockImplementation(async () => ({ ...user })),
    touchLastOnline: jest.fn().mockResolvedValue(undefined),
  };
  return new AuthMiddleware(organizationService as any, userService as any);
};

const request = (claims: Record<string, unknown>, cookies: Record<string, string> = {}) => ({
  headers: {},
  cookies: {
    auth: AuthService.signJWT({ id: admin.id, email: admin.email, tokenVersion: 1, sid: 's-1', ...claims }),
    ...cookies,
  },
  path: '/posts',
  url: '/posts',
  ip: '203.0.113.7',
});

const run = async (claims: Record<string, unknown>, user: any = admin, cookies = {}) => {
  const req: any = request(claims, cookies);
  await build(user).use(req, { cookie: jest.fn(), header: jest.fn() } as any, jest.fn());
  return req;
};

beforeEach(async () => {
  await ioRedis.del(`authctx:${admin.id}`).catch(() => undefined);
});

describe('administrator powers need the second factor', () => {
  it('a password-only session is an ordinary member, marked as waiting for the code', async () => {
    const req = await run({});
    expect(req.user.isSuperAdmin).toBe(false);
    expect(req.user.adminMfaPending).toBe(true);
  });

  it('a session with a fresh code has the administrator flag', async () => {
    const req = await run({ mfa: now() });
    expect(req.user.isSuperAdmin).toBe(true);
    expect(req.user.adminMfaPending).toBeUndefined();
  });

  it('a code older than 12 hours does not count any more', async () => {
    const req = await run({ mfa: now() - ADMIN_MFA_MAX_AGE_SECONDS - 1 });
    expect(req.user.isSuperAdmin).toBe(false);
    expect(req.user.adminMfaPending).toBe(true);
  });

  it('a claim from the future or of the wrong type does not count', () => {
    expect(adminMfaFresh({ mfa: now() + 3600 })).toBe(false);
    expect(adminMfaFresh({ mfa: String(now()) })).toBe(false);
    expect(adminMfaFresh({ mfa: true })).toBe(false);
    expect(adminMfaFresh(null)).toBe(false);
    expect(adminMfaFresh({ mfa: now() - 60 })).toBe(true);
  });

  it('cannot impersonate without the code, and can with it', async () => {
    const without = await run({}, admin, { impersonate: 'uo-c' });
    expect(without.user.id).toBe(admin.id);
    expect(without.impersonatedBy).toBeUndefined();

    const withCode = await run({ mfa: now() }, admin, { impersonate: 'uo-c' });
    expect(withCode.user.id).toBe('customer-1');
    expect(withCode.impersonatedBy).toBe(admin.id);
  });

  it('keeps the real flag in the cache, so the next session with a code is not refused', async () => {
    await run({});
    const cached = JSON.parse((await ioRedis.get(`authctx:${admin.id}`)) as string);
    expect(cached.user.isSuperAdmin).toBe(true);
    expect(cached.user.adminMfaPending).toBeUndefined();
    const req = await run({ mfa: now() });
    expect(req.user.isSuperAdmin).toBe(true);
  });

  it('a claim on an ordinary account changes nothing', async () => {
    const member = { ...admin, id: 'member-1', isSuperAdmin: false };
    const req: any = {
      ...request({ mfa: now() }),
    };
    req.cookies.auth = AuthService.signJWT({ id: member.id, email: member.email, tokenVersion: 1, mfa: now() });
    await build(member).use(req, { cookie: jest.fn(), header: jest.fn() } as any, jest.fn());
    expect(req.user.isSuperAdmin).toBe(false);
    expect(req.user.adminMfaPending).toBeUndefined();
  });
});

describe('with ADMIN_TOTP_REQUIRED off, the password is enough', () => {
  beforeEach(() => {
    delete process.env.ADMIN_TOTP_REQUIRED;
  });
  afterEach(() => {
    process.env.ADMIN_TOTP_REQUIRED = 'true';
  });

  it('a password-only session has the administrator flag and is not sent to the code', async () => {
    const req = await run({});
    expect(req.user.isSuperAdmin).toBe(true);
    expect(req.user.adminMfaPending).toBeUndefined();
  });

  it('can impersonate without a code', async () => {
    const req = await run({}, admin, { impersonate: 'uo-c' });
    expect(req.user.id).toBe('customer-1');
    expect(req.impersonatedBy).toBe(admin.id);
  });

  it('only "true" turns it on', async () => {
    process.env.ADMIN_TOTP_REQUIRED = 'false';
    expect((await run({})).user.isSuperAdmin).toBe(true);
    process.env.ADMIN_TOTP_REQUIRED = 'true';
    expect((await run({})).user.isSuperAdmin).toBe(false);
  });
});
