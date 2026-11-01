import { platformName } from './platform.name';

describe('platformName', () => {
  it.each([
    ['linkedin', 'LinkedIn'],
    ['linkedin-page', 'LinkedIn Page'],
    ['tiktok', 'TikTok'],
    ['youtube', 'YouTube'],
    ['instagram-standalone', 'Instagram'],
    ['wordpress', 'WordPress'],
    ['x', 'X'],
    ['gmb', 'Google Business'],
    ['nostr', 'Nostr'],
  ])('%s reads %s', (id, name) => {
    expect(platformName(id)).toBe(name);
  });
});
