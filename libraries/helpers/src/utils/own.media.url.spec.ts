import { isOwnMediaUrl } from './own.media.url';

const env = {
  NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: 'https://cdn-dev.postra.pl',
  FRONTEND_URL: 'https://app.postra.pl',
};

describe('isOwnMediaUrl (E2E-02-22)', () => {
  it('accepts our CDN and the app', () => {
    expect(isOwnMediaUrl('https://cdn-dev.postra.pl/uploads/2026/10/03/a.png', env)).toBe(true);
    expect(isOwnMediaUrl('https://app.postra.pl/uploads/a.mp4', env)).toBe(true);
  });

  it('refuses any other host, including ones that only contain ours', () => {
    expect(isOwnMediaUrl('https://evil.example/a.png', env)).toBe(false);
    expect(isOwnMediaUrl('https://evil.example/cdn-dev.postra.pl/a.png', env)).toBe(false);
    expect(isOwnMediaUrl('https://cdn-dev.postra.pl.evil.example/a.png', env)).toBe(false);
    expect(isOwnMediaUrl('http://169.254.169.254/a.png', env)).toBe(false);
    expect(isOwnMediaUrl('not a url', env)).toBe(false);
  });

  it('honours RESTRICT_UPLOAD_DOMAINS as a list', () => {
    const e = { ...env, RESTRICT_UPLOAD_DOMAINS: 'media.example.com, cdn.postra.co.uk' };
    expect(isOwnMediaUrl('https://cdn.postra.co.uk/a.png', e)).toBe(true);
    expect(isOwnMediaUrl('https://media.example.com/a.png', e)).toBe(true);
  });

  it('lets anything through on an install with no storage configured', () => {
    expect(isOwnMediaUrl('https://anywhere.example/a.png', {})).toBe(true);
  });
});
