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
