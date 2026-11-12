jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { AutopostService } from './autopost.service';

// Auto Post writes one version of the article per platform. Instagram without
// a Facebook Page is the same Instagram, but it was not in the map and got the
// general text instead of the caption with hashtags.
describe('Auto Post text per platform', () => {
  const s = Object.create(AutopostService.prototype) as any;
  const state = {
    description: 'desc',
    platformContent: {
      linkedin: 'li',
      twitter: 'tw',
      instagram: 'ig',
      facebook: 'fb',
      generic: 'gen',
    },
  };
  const text = (id: string) => s.getContentForProvider(id, state);

  it.each([
    ['instagram', 'ig'],
    ['instagram-standalone', 'ig'],
    ['facebook', 'fb'],
    ['linkedin', 'li'],
    ['x', 'tw'],
    ['telegram', 'gen'],
  ])('%s gets its own version', (id, expected) => {
    expect(text(id)).toBe(expected);
  });
});
