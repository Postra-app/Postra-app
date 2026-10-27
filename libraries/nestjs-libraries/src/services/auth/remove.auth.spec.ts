import {
  expireDomainWideCookies,
  removeAuth,
  sessionCookieOptions,
} from './remove.auth';

// A stand-in for Express's Response that records cookies the way the browser
// would receive them.
const fakeResponse = () => {
  const cookies: { name: string; value: string; options: any }[] = [];
  const headers: Record<string, string> = {};
  const res = {
    cookie: (name: string, value: string, options: any) => {
      cookies.push({ name, value, options });
      return res;
    },
    header: (k: string, v: string) => {
      headers[k] = v;
      return res;
    },
  };
  return { res: res as any, cookies, headers };
};

/**
 * E2E-11-78 — Postra's cookies carried Domain=.postra.co.uk, so the browser
 * sent the session token to every subdomain: the landing pages, the CDN and
 * status.postra.co.uk, which GitHub Pages serves (measured on production
 * 2026-10-27). They are host-only now, and the domain-wide ones a browser
 * still holds are expired wherever a session starts or ends.
 */
describe('session cookies are host-only (E2E-11-78)', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.postra.co.uk';
    delete process.env.NOT_SECURED;
  });
  afterAll(() => {
    process.env = env;
  });

  it('sets the session cookie without a Domain', () => {
    const options = sessionCookieOptions();
    expect(options).not.toHaveProperty('domain');
    expect(options).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('expires the domain-wide leftovers for .postra.co.uk', () => {
    const { res, cookies } = fakeResponse();
    expireDomainWideCookies(res);
    expect(cookies.map((c) => c.name).sort()).toEqual(
      ['auth', 'impersonate', 'showorg'].sort()
    );
    for (const c of cookies) {
      expect(c.options.domain).toBe('.postra.co.uk');
      expect(c.options.expires.getTime()).toBe(0);
    }
  });

  it('signing out on a 401 clears the host-only cookie and the leftover', () => {
    const { res, cookies, headers } = fakeResponse();
    removeAuth(res);
    const auth = cookies.filter((c) => c.name === 'auth');
    expect(auth.map((c) => c.options.domain)).toEqual(
      expect.arrayContaining([undefined, '.postra.co.uk'])
    );
    expect(headers.logout).toBe('true');
  });

  it('has no leftover to clear on a bare host such as localhost', () => {
    process.env.FRONTEND_URL = 'http://localhost:4200';
    const { res, cookies } = fakeResponse();
    expireDomainWideCookies(res);
    expect(cookies).toEqual([]);
  });
});
