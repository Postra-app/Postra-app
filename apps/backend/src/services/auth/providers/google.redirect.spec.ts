import { safeRedirect } from './google.provider';

// E2E-03-02: the caller's redirect_uri went straight into Google's auth URL.
describe('Google sign-in redirect_uri', () => {
  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://app.postra.pl';
  });

  it('keeps an address on this app', () => {
    expect(safeRedirect('https://app.postra.pl/integrations/social/youtube?x=1')).toBe(
      'https://app.postra.pl/integrations/social/youtube?x=1'
    );
  });

  it('replaces anything else with the default', () => {
    for (const bad of ['https://evil.example/cb', 'https://app.postra.pl.evil.example/', 'javascript:alert(1)', 'not a url', undefined]) {
      expect(safeRedirect(bad)).toBe('https://app.postra.pl/integrations/social/youtube');
    }
  });
});
