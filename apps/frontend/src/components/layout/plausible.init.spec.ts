/**
 * @jest-environment jsdom
 */
import { PLAUSIBLE_CLEAN_URL, PLAUSIBLE_INIT } from './plausible.init';

// The address of a page can be a secret: a reset link, an activation code,
// an invitation, a preview id, an OAuth code. None of it goes to analytics.
describe('what Plausible is told about a page', () => {
  const origin = window.location.origin;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const clean = new Function(`return (${PLAUSIBLE_CLEAN_URL})`)() as (u: string) => string;

  const jwt =
    'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InUxIiwidG9rZW5WZXJzaW9uIjozfQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

  it.each([
    [`/auth/forgot/${jwt}`, '/auth/forgot/:id'],
    [`/auth/forgot/${jwt}?confirmed=1`, '/auth/forgot/:id'],
    [`/auth/activate/${jwt}`, '/auth/activate/:id'],
    ['/auth/activate/short', '/auth/activate/:id'],
    ['/connect/instagram/abcDEFghi', '/connect/instagram/:id'],
    ['/p/cmh2x9k1z0001abcd', '/p/:id'],
    ['/p/cmh2x9k1z0001abcd?share=true', '/p/:id'],
    ['/join/abcdefgh', '/join/:id'],
    ['/integrations/social/youtube?code=4/0AbCd&state=xyz123', '/integrations/social/youtube'],
    ['/auth/register?code=4/0AbCd&state=auth-1f2e', '/auth/register'],
    ['/auth?org=eyJhbGciOi.invite.token', '/auth'],
    ['/launches', '/launches'],
    ['/settings#team', '/settings'],
  ])('%s is reported as %s', (page, reported) => {
    expect(clean(origin + page)).toBe(origin + reported);
  });

  it('keeps campaign tags and nothing else from the query', () => {
    expect(clean(`${origin}/auth/login?utm_source=news&utm_campaign=d1&token=abc&ref=x`)).toBe(
      `${origin}/auth/login?utm_source=news&utm_campaign=d1&ref=x`
    );
  });

  it("leaves another site's address as it is", () => {
    expect(clean('https://www.google.com/search?q=postra')).toBe('https://www.google.com/search?q=postra');
  });

  it('is wired into the request the script sends', () => {
    const w = window as any;
    delete w.plausible;
    // eslint-disable-next-line no-eval
    (0, eval)(PLAUSIBLE_INIT);
    const sent = w.plausible.o.transformRequest({
      n: 'pageview',
      u: `${origin}/auth/forgot/${jwt}?x=1`,
      r: `${origin}/p/cmh2x9k1z0001abcd`,
    });
    expect(sent).toEqual({ n: 'pageview', u: `${origin}/auth/forgot/:id`, r: `${origin}/p/:id` });
  });
});
