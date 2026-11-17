import { isAllowedUrl } from './read.or.fetch';

const env = {
  NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: 'https://cdn.postra.co.uk',
  FRONTEND_URL: 'https://app.postra.co.uk',
  RESTRICT_UPLOAD_DOMAINS: 'cdn-dev.postra.pl',
};

describe('readOrFetch hosts', () => {
  // Media are fetched from our CDN before they go to a platform. The CDN
  // moved to cdn.postra.co.uk (2026-10-27) while only *.postra.pl was let
  // through, so every post with media would have failed.
  it('fetches from our CDN, under its current and its older name', () => {
    expect(isAllowedUrl('https://cdn.postra.co.uk/2026/10/27/a.png', env)).toBe(true);
    expect(isAllowedUrl('https://cdn-dev.postra.pl/2026/10/01/a.mp4', env)).toBe(true);
  });

  it('still fetches avatars from the platforms', () => {
    expect(isAllowedUrl('https://pbs.twimg.com/profile_images/a.jpg', env)).toBe(true);
    expect(isAllowedUrl('https://scontent-lhr8-1.cdninstagram.com/a.jpg', env)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isAllowedUrl('https://evil.example/a.png', env)).toBe(false);
    expect(isAllowedUrl('https://cdn.postra.co.uk.evil.example/a.png', env)).toBe(false);
    expect(isAllowedUrl('http://cdn.postra.co.uk/a.png', env)).toBe(false);
    expect(isAllowedUrl('https://169.254.169.254/latest/meta-data', env)).toBe(false);
  });

  it('lets nothing through as our own on an install with no storage configured', () => {
    expect(isAllowedUrl('https://anywhere.example/a.png', {})).toBe(false);
  });
});

describe('readOrFetch redirects', () => {
  const realEnv = process.env;
  beforeEach(() => {
    process.env = { ...realEnv, ...env };
  });
  afterEach(() => {
    process.env = realEnv;
  });

  // An allowed host that answers with a redirect must not take the request
  // anywhere else: each hop is checked like the first address.
  it('refuses a redirect from an allowed host to any other address', () => {
    const { refuseRedirectOutsideAllowedHosts } = require('./read.or.fetch');
    expect(() =>
      refuseRedirectOutsideAllowedHosts({
        protocol: 'http:',
        hostname: '169.254.169.254',
        path: '/latest/meta-data/',
      })
    ).toThrow('blocked redirect');
    expect(() =>
      refuseRedirectOutsideAllowedHosts({ href: 'https://evil.example/a.png' })
    ).toThrow('blocked redirect');
    expect(() =>
      refuseRedirectOutsideAllowedHosts({
        protocol: 'https:',
        hostname: 'cdn.postra.co.uk',
        path: '/2026/11/17/a.png',
      })
    ).not.toThrow();
  });

  it('hands that check to the HTTP client for every fetch', async () => {
    jest.resetModules();
    const axios = jest.fn().mockResolvedValue({ data: Buffer.from('x') });
    jest.doMock('axios', () => ({ __esModule: true, default: axios }));
    const { readOrFetch, refuseRedirectOutsideAllowedHosts } = require('./read.or.fetch');
    await readOrFetch('https://cdn.postra.co.uk/2026/11/17/a.png');
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRedirects: 2,
        beforeRedirect: refuseRedirectOutsideAllowedHosts,
      })
    );
    jest.dontMock('axios');
  });
});
