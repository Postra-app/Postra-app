import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const signedOut = (path: string) =>
  proxy(new NextRequest(new URL(path, 'https://app.postra.pl')));

describe('proxy — signed-out redirects', () => {
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
