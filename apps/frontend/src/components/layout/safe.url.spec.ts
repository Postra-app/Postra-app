import { isLogoutPath, isNavigableUrl, sameOriginUrl } from './safe.url';

const origin = 'https://app.postra.pl';

describe('URLs taken from parameters', () => {
  it('E2E-08-30: after sign-in, only a page of this app', () => {
    expect(sameOriginUrl('/oauth/authorize?client_id=x', origin)).toBe(`${origin}/oauth/authorize?client_id=x`);
    expect(sameOriginUrl(`${origin}/launches`, origin)).toBe(`${origin}/launches`);
    for (const bad of ['javascript:alert(1)//http', 'JaVaScRiPt:alert(1)', 'https://attacker.example/continue', '//attacker.example', 'data:text/html,x']) {
      expect(sameOriginUrl(bad, origin)).toBeNull();
    }
  });

  it('E2E-08-31: a connect flow returns to web pages or the app, never to script', () => {
    for (const ok of ['/launches', 'https://example.com/back', 'postra://integrations']) {
      expect(isNavigableUrl(ok, origin)).toBe(true);
    }
    for (const bad of ['javascript:alert(location.origin)//', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(isNavigableUrl(bad, origin)).toBe(false);
    }
  });

  it('E2E-08-32: only the sign-out route signs out', () => {
    expect(isLogoutPath('/auth/logout')).toBe(true);
    expect(isLogoutPath('/launches')).toBe(false);
    expect(isLogoutPath('/integrations/auth/logout-x')).toBe(false);
  });
});
