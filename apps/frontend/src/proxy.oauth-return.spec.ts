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
