import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const signedOut = (path: string) =>
  proxy(new NextRequest(new URL(path, 'https://app.postra.pl')));

describe('proxy - signed-out redirects', () => {
  it('keeps the OAuth consent request so login returns to it', async () => {
    const path =
      '/oauth/authorize?client_id=abc&response_type=code&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&state=s1';
    const location = new URL((await signedOut(path)).headers.get('location')!);
    expect(location.pathname).toBe('/auth');
    expect(location.searchParams.get('returnUrl')).toBe(path);
  });

  it('sends other pages to /auth as before', async () => {
    const location = new URL(
      (await signedOut('/launches')).headers.get('location')!
    );
    expect(location.pathname).toBe('/auth');
    expect(location.searchParams.get('returnUrl')).toBeNull();
  });
});

// Upstream b958c5d59 (adapted): the invitation link lives 1 hour
// (organization.service.ts), but the cookie that carries it through sign-up
// lived 15 minutes, so a slower sign-up lost the invitation.
describe('proxy - invitation cookie', () => {
  it('keeps the invitation for as long as the link is valid', async () => {
    const before = Date.now();
    const res = await signedOut('/auth?org=invite-token');
    const cookie = res.cookies.get('org');
    expect(cookie?.value).toBe('invite-token');
    const expires = new Date(cookie!.expires as any).getTime();
    expect(expires - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
  });
});

// E2E-11-78: cookies were set for the whole domain (.postra.co.uk), so the
// session token reached every subdomain, the status page on GitHub Pages
// among them. They are host-only now; signing out also expires the
// domain-wide `auth` a browser may still hold.
describe('proxy - cookies stay on the app host', () => {
  const frontendUrl = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.postra.co.uk';
  });
  afterAll(() => {
    process.env.FRONTEND_URL = frontendUrl;
  });

  const setCookies = (res: Response) =>
    (res.headers as any).getSetCookie() as string[];

  it('signing out clears the host-only auth and the domain-wide leftover', async () => {
    const res = await proxy(
      new NextRequest(new URL('/auth/logout', 'https://app.postra.co.uk'))
    );
    const auth = setCookies(res).filter((c) => c.startsWith('auth='));
    expect(auth.some((c) => !/domain=/i.test(c))).toBe(true);
    expect(auth.some((c) => /domain=\.postra\.co\.uk/i.test(c))).toBe(true);
  });

  it('keeps the invitation on the app host', async () => {
    const res = await signedOut('/auth?org=invite-token');
    const org = setCookies(res).find((c) => c.startsWith('org='));
    expect(org).toBeDefined();
    expect(org).not.toMatch(/domain=/i);
  });
});
