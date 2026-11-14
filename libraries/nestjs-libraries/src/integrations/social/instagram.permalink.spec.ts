jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn().mockResolvedValue(undefined) }));

import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

const json = (body: unknown) => ({ json: async () => body }) as Response;

// The permalink is read after media_publish, when the post is already live.
// A failure of that read failed the whole publish: the post was marked as
// failed although it was on Instagram, and the retry published again
// (upstream #1681).
describe('Instagram: the permalink read after publishing', () => {
  const publish = async (permalink: () => unknown, media: { path: string }[]) => {
    const p = new InstagramProvider();
    jest.spyOn(p as any, 'toInstagramSafeMedia').mockImplementation(async (m: unknown) => m);
    let published = 0;
    jest.spyOn(p, 'fetch').mockImplementation(async (url: string) => {
      if (url.includes('fields=permalink')) return json(permalink());
      if (url.includes('media_publish')) {
        published++;
        return json({ id: 'media-42' });
      }
      if (url.includes('fields=status_code')) return json({ status_code: 'FINISHED' });
      return json({ id: 'container-1' });
    });
    const result = await p.post(
      'ig-1',
      'page-token___user-token',
      [{ id: 'post-1', message: 'Hello Bristol', settings: { post_type: 'post' }, media: media as any }] as any,
      { profile: 'postra.uk' } as any
    );
    return { result, published };
  };
  const fails = () => {
    throw new Error('Graph is down');
  };

  it('a failed read still reports the post as published, once', async () => {
    for (const media of [[{ path: 'https://cdn.example/a.jpg' }], [{ path: 'https://cdn.example/a.jpg' }, { path: 'https://cdn.example/b.jpg' }]]) {
      const { result, published } = await publish(fails, media);
      expect(published).toBe(1);
      expect(result).toEqual([
        { id: 'post-1', postId: 'media-42', releaseURL: 'https://www.instagram.com/postra.uk', status: 'success' },
      ]);
    }
  });

  it('a successful read gives the post its own link', async () => {
    const { result } = await publish(() => ({ permalink: 'https://www.instagram.com/p/abc/' }), [{ path: 'https://cdn.example/a.jpg' }]);
    expect(result[0].releaseURL).toBe('https://www.instagram.com/p/abc/');
  });
});

// A page reached through a business the user has no role on has no page
// token: the channel was saved with "undefined___<user token>" (upstream #1719).
describe('Instagram: choosing a page without a page token', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is refused with the reason instead of saving a broken channel', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => json({ name: 'Page', id: 'page-1' }));
    await expect(
      new InstagramProvider().fetchPageInformation('user-token', { pageId: '111', id: '222' })
    ).rejects.toThrow(/no permission to manage this page/);
  });

  it('a page with a token is saved as before', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(async () => json({ access_token: 'page-token', name: 'Page' }))
      .mockImplementationOnce(async () => json({ id: '222', name: 'Shop', username: 'shop', profile_picture_url: 'x' }));
    const info = await new InstagramProvider().fetchPageInformation('user-token', { pageId: '111', id: '222' });
    expect(info.access_token).toBe('page-token___user-token');
  });
});
