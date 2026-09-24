process.env.JWT_SECRET = 'test-secret';
process.env.FRONTEND_URL = 'https://app.postra.pl';
process.env.NOT_SECURED = '';

import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

// E2E-10-82: a user in two organizations switched in the mobile app and kept
// seeing the previous one's channels and posts. The app picks the organization
// with the `showorg` header, but its native HTTP client also stores the
// year-long `showorg` cookie set by /user/change-org — and the middleware read
// the cookie first. Measured on production 2026-09-24: cookie A + header B
// returned organization A.

const user = {
  id: 'user-1',
  email: 'agency@example.com',
  isSuperAdmin: false,
  activated: true,
  tokenVersion: 1,
  password: 'hash',
};

const org = (id: string) => ({
  id,
  name: id,
  apiKey: 'key',
  users: [{ userId: 'user-1', disabled: false, role: 'SUPERADMIN' }],
});

const build = () =>
  new AuthMiddleware(
    {
      getOrgsByUserId: jest.fn().mockResolvedValue([org('org-a'), org('org-b')]),
      updateApiKey: jest.fn(),
    } as any,
    {
      getUserById: jest.fn().mockResolvedValue({ ...user }),
      touchLastOnline: jest.fn().mockResolvedValue(undefined),
    } as any
  );

const run = async (header?: string, cookie?: string) => {
  const req: any = {
    headers: {
      auth: AuthService.signJWT({ ...user, password: undefined }),
      ...(header ? { showorg: header } : {}),
    },
    cookies: cookie ? { showorg: cookie } : {},
    path: '/integrations/list',
    url: '/integrations/list',
    ip: '203.0.113.7',
  };
  await build().use(req, { cookie: jest.fn(), header: jest.fn() } as any, jest.fn());
  return req.org?.id;
};

describe('which organization a request is served from', () => {
  it('the header wins over a stale cookie — the mobile app case', async () => {
    expect(await run('org-b', 'org-a')).toBe('org-b');
  });

  it('the cookie alone still selects it — the browser case', async () => {
    expect(await run(undefined, 'org-b')).toBe('org-b');
  });

  it('the header alone selects it', async () => {
    expect(await run('org-b')).toBe('org-b');
  });

  it('a header naming someone else\'s organization does not beat a valid cookie', async () => {
    expect(await run('org-elsewhere', 'org-b')).toBe('org-b');
  });

  it('with nothing valid it falls back to the first organization', async () => {
    expect(await run('org-elsewhere', 'org-nowhere')).toBe('org-a');
  });
});
