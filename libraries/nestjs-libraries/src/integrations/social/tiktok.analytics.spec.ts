import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';

// TikTok approved the two scopes that read a channel's numbers: account
// totals (user.info.stats) and the latest videos (video.list, which also
// covers video/query for post statistics). Without them in the sign-in the
// Analytics page only ever showed empty cards.
describe('TikTok analytics scopes', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
    jest.restoreAllMocks();
  });

  it('asks TikTok for the scopes that read the numbers', async () => {
    process.env = { ...env, FRONTEND_URL: 'https://app.example.test', TIKTOK_CLIENT_ID: 'ck' };
    const { url } = await new TiktokProvider().generateAuthUrl();
    const scopes = new URL(url).searchParams.get('scope')!.split(',');
    expect(scopes).toEqual(
      expect.arrayContaining(['user.info.stats', 'video.list', 'video.publish', 'video.upload'])
    );
  });

  it('reads account totals and the latest videos into cards', async () => {
    const calls: string[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const u = String(input);
      calls.push(u.split('?')[0]);
      const body = u.includes('/user/info/')
        ? { data: { user: { follower_count: 12, following_count: 3, likes_count: 40, video_count: 5 } } }
        : u.includes('/video/list/')
          ? { data: { videos: [{ id: 'a' }, { id: 'b' }] } }
          : { data: { videos: [
              { id: 'a', view_count: 100, like_count: 7, comment_count: 2, share_count: 1 },
              { id: 'b', view_count: 50, like_count: 3, comment_count: 0, share_count: 0 },
            ] } };
      return new Response(JSON.stringify(body));
    });
    const cards = await new TiktokProvider().analytics('id', 'token', 7);
    const byLabel = Object.fromEntries(cards.map((c) => [c.label, c.data[0].total]));
    expect(byLabel).toMatchObject({
      Followers: '12',
      'Total Likes': '40',
      Videos: '5',
      Views: '150',
      'Recent Likes': '10',
      'Recent Comments': '2',
      'Recent Shares': '1',
    });
    expect(calls).toEqual([
      'https://open.tiktokapis.com/v2/user/info/',
      'https://open.tiktokapis.com/v2/video/list/',
      'https://open.tiktokapis.com/v2/video/query/',
    ]);
  });
});
