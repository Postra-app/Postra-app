process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://app.postra.pl';
process.env.NOT_SECURED = '';

import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { currentAuditActor } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.actor';
import { IMPERSONATE_MAX_AGE_MS } from '@gitroom/backend/services/auth/impersonate.cookie';

// E2E-09-23: the impersonation branch set isSuperAdmin = true on the *target*,
// so every `user.isSuperAdmin` gate in the product kept opening while the
// identity behind the request was the customer's. grant-admin, add-subscription
// and the debug export all worked from inside such a session, and every audit
// row it produced named the customer.

const admin = {
  id: 'admin-1',
  email: 'admin@postra.pl',
  isSuperAdmin: true,
  activated: true,
  tokenVersion: 1,
  password: 'hash',
};

const customer = {
  id: 'customer-9',
  email: 'customer@example.com',
  isSuperAdmin: false,
  activated: true,
  tokenVersion: 1,
  password: 'hash',
};

const customerOrg = {
  id: 'org-9',
  name: 'Acme',
  users: [{ id: 'uo-1', userId: 'customer-9', role: 'SUPERADMIN', disabled: false }],
  apiKey: 'key',
  subscription: null as any,
};

const build = (target: any) => {
  const organizationService = {
    getUserOrg: jest.fn().mockResolvedValue(target),
    getOrgsByUserId: jest.fn().mockResolvedValue([
      {
        id: 'org-1',
        name: 'Postra',
        apiKey: 'key',
        users: [{ userId: 'admin-1', disabled: false, role: 'SUPERADMIN' }],
      },
    ]),
    updateApiKey: jest.fn(),
  };
  const userService = {
    getUserById: jest.fn().mockResolvedValue({ ...admin }),
    touchLastOnline: jest.fn().mockResolvedValue(undefined),
  };
  return {
    middleware: new AuthMiddleware(
      organizationService as any,
      userService as any
    ),
    organizationService,
  };
};

const request = (path: string) => ({
  headers: { 'user-agent': 'Chrome/140', 'x-forwarded-for': '203.0.113.7' },
  cookies: {
    auth: AuthService.signJWT({ ...admin, password: undefined }),
    impersonate: 'uo-1',
  },
  path,
  url: path,
  ip: '203.0.113.7',
});

const response = () => ({ cookie: jest.fn(), header: jest.fn() });

const impersonatedTarget = { user: { ...customer }, organization: { ...customerOrg } };

describe('a session that is impersonating', () => {
  it('carries the target permissions, not the admin ones', async () => {
    const { middleware } = build(impersonatedTarget);
    const req: any = request('/posts');
    await middleware.use(req, response() as any, jest.fn());

    expect(req.user.id).toBe('customer-9');
    expect(req.user.isSuperAdmin).toBe(false);
  });

  it('still says who is really behind the request', async () => {
    const { middleware } = build(impersonatedTarget);
    const req: any = request('/posts');
    await middleware.use(req, response() as any, jest.fn());

    expect(req.impersonatedBy).toBe('admin-1');
  });

  it('puts the real admin and the target into the audit actor', async () => {
    const { middleware } = build(impersonatedTarget);
    const seen: any[] = [];
    await middleware.use(request('/posts') as any, response() as any, () =>
      seen.push(currentAuditActor())
    );

    expect(seen[0]).toEqual(
      expect.objectContaining({
        userId: 'admin-1',
        impersonatedUserId: 'customer-9',
        ip: '203.0.113.7',
        userAgent: 'Chrome/140',
      })
    );
  });

  it('cannot reach the admin surface', async () => {
    const { middleware } = build(impersonatedTarget);
    const next = jest.fn();

    await expect(
      middleware.use(request('/admin/users') as any, response() as any, next)
    ).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it('cannot comp a subscription to the org it is wearing', async () => {
    const { middleware } = build(impersonatedTarget);
    const next = jest.fn();

    await expect(
      middleware.use(
        request('/billing/add-subscription') as any,
        response() as any,
        next
      )
    ).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it('renews its own window on activity instead of running for a year', async () => {
    const { middleware } = build(impersonatedTarget);
    const res = response();
    await middleware.use(request('/posts') as any, res as any, jest.fn());

    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe('impersonate');
    expect(value).toBe('uo-1');
    expect(options.maxAge).toBe(IMPERSONATE_MAX_AGE_MS);
    expect(IMPERSONATE_MAX_AGE_MS).toBeLessThan(60 * 60 * 1000);
  });
});

describe('a target the impersonation must not resolve to', () => {
  it('falls back to the admin when the id matches nothing', async () => {
    const { middleware } = build(null);
    const req: any = request('/posts');
    await middleware.use(req, response() as any, jest.fn());

    expect(req.user.id).toBe('admin-1');
    expect(req.impersonatedBy).toBeUndefined();
  });
});

describe('an ordinary session', () => {
  it('is its own actor, with no target attached', async () => {
    const { middleware } = build(null);
    const req: any = request('/posts');
    req.cookies.impersonate = undefined;

    const seen: any[] = [];
    await middleware.use(req, response() as any, () =>
      seen.push(currentAuditActor())
    );

    expect(req.user.id).toBe('admin-1');
    expect(seen[0].userId).toBe('admin-1');
    expect(seen[0].impersonatedUserId).toBeUndefined();
  });
});
