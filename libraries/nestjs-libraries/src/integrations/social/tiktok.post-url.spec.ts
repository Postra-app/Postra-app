import { tiktokPostUrl } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';

// TikTok answers 403 for /video/<id> of a photo post: the link stored after
// publishing has to follow the kind of post (upstream 6f79545d).
describe('tiktokPostUrl', () => {
  it('links a photo post (p_pub_ publish id) under /photo/', () => {
    expect(tiktokPostUrl('postra', 'p_pub_url~v2.123', '7556')).toBe(
      'https://www.tiktok.com/@postra/photo/7556'
    );
  });

  it('links a video post under /video/', () => {
    expect(tiktokPostUrl('postra', 'v_pub_url~v2.123', '7556')).toBe(
      'https://www.tiktok.com/@postra/video/7556'
    );
  });

  it('falls back to the profile while TikTok has no public id', () => {
    expect(tiktokPostUrl('postra', 'p_pub_url~v2.123')).toBe(
      'https://www.tiktok.com/@postra'
    );
  });
});
