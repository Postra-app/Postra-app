import { ANALYTICS_CHANNELS, ANALYTICS_SUPPORTED_NAMES } from './analytics.channels';

describe('Analytics channels', () => {
  it('has a page for TikTok now that its numbers can be read', () => {
    expect(ANALYTICS_CHANNELS).toContain('tiktok');
  });

  it('names the supported platforms, not their ids', () => {
    expect(ANALYTICS_SUPPORTED_NAMES.join(', ')).toBe(
      'Facebook, Instagram, Threads, X, YouTube, Pinterest, TikTok'
    );
  });
});
