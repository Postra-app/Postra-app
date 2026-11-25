import { getCookieUrlFromDomain, legacyCookieDomain } from './subdomain.management';

// The registrable domain comes from tldts and the public suffix list; these
// are the hosts the app runs on, so a library upgrade that changes the answer
// fails here instead of leaving old domain-wide cookies behind at sign-out.
describe('getCookieUrlFromDomain', () => {
  it.each([
    ['https://app.postra.co.uk', '.postra.co.uk'],
    ['https://staging.postra.co.uk', '.postra.co.uk'],
    ['https://app.postra.pl', '.postra.pl'],
    ['http://localhost:4200', 'localhost'],
    ['http://127.0.0.1:4200', '127.0.0.1'],
  ])('%s -> %s', (url, expected) => {
    expect(getCookieUrlFromDomain(url)).toBe(expected);
  });
});

describe('legacyCookieDomain', () => {
  it('is the parent domain for a subdomain host', () => {
    expect(legacyCookieDomain('https://app.postra.co.uk')).toBe('.postra.co.uk');
  });

  it('is undefined for a bare host and for no URL', () => {
    expect(legacyCookieDomain('http://localhost:4200')).toBeUndefined();
    expect(legacyCookieDomain('')).toBeUndefined();
  });
});
