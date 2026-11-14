import { TiktokProvider } from './tiktok.provider';

// The cover frame chosen in the composer went out as
// source_info.video_cover_timestamp_ms. TikTok's Direct Post reference lists
// the field under post_info, so it was ignored and every video got its first
// frame as the cover (upstream #1450).
describe('TikTok video cover frame', () => {
  const body = (method: string, thumbnailTimestamp?: number, path = 'https://cdn.example/clip.mp4') => {
    const provider = new TiktokProvider() as any;
    const post = {
      id: 'p1',
      message: 'Hello Bristol',
      settings: { content_posting_method: method, privacy_level: 'PUBLIC_TO_EVERYONE' },
      media: [{ path, thumbnailTimestamp }],
    };
    return { ...provider.buildTikokPostInfoBody(post), ...provider.buildTikokSourceInfoBody(post) };
  };

  it('goes in post_info on a direct post', () => {
    const sent = body('DIRECT_POST', 4200);
    expect(sent.post_info.video_cover_timestamp_ms).toBe(4200);
    expect(sent.source_info).toEqual({ source: 'PULL_FROM_URL', video_url: 'https://cdn.example/clip.mp4' });
  });

  it('is left out when no frame was chosen, and for photos', () => {
    expect(body('DIRECT_POST').post_info).not.toHaveProperty('video_cover_timestamp_ms');
    expect(body('DIRECT_POST', 4200, 'https://cdn.example/a.jpg').post_info).not.toHaveProperty('video_cover_timestamp_ms');
  });

  it('an upload to the TikTok inbox is sent as before', () => {
    const sent = body('UPLOAD', 4200);
    expect(sent.source_info.video_cover_timestamp_ms).toBe(4200);
    expect(sent.post_info).not.toHaveProperty('video_cover_timestamp_ms');
  });
});
