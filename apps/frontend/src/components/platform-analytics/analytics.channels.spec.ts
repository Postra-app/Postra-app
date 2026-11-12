import { ANALYTICS_CHANNELS, ANALYTICS_SUPPORTED_NAMES } from './analytics.channels';

describe('Analytics channels', () => {
  it('leaves out TikTok while its numbers cannot be read', () => {
    expect(ANALYTICS_CHANNELS).not.toContain('tiktok');
  });

  it('names the supported platforms, not their ids', () => {
    expect(ANALYTICS_SUPPORTED_NAMES.join(', ')).toBe(
      'Facebook, Instagram, Threads, X, YouTube, Pinterest'
    );
  });
});
