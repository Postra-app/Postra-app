jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: async () => undefined }));
jest.mock('@gitroom/nestjs-libraries/integrations/social/instagram.aspect', () => ({
  toInstagramSafeAspect: async (path: string) => path,
}));

import {
  IG_ALT_TEXT_MAX,
  InstagramProvider,
} from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';

// Upstream 63ae45050: the composer's alt text never reached Instagram, which
// takes it as alt_text on image containers (single image or carousel item).
describe('Instagram alt text', () => {
  const containerUrls = async (
    media: Array<{ path: string; alt?: string }>,
    settings: Record<string, unknown> = {}
  ) => {
    const p = new InstagramProvider();
    const urls: string[] = [];
    let n = 0;
    jest.spyOn(p, 'fetch').mockImplementation(async (url: string) => {
      urls.push(url);
      const body = url.includes('fields=status_code')
        ? { status_code: 'FINISHED' }
        : url.includes('fields=permalink')
        ? { permalink: 'https://www.instagram.com/p/x/' }
        : { id: `id-${++n}` };
      return { json: async () => body } as Response;
    });
    await p.post(
      'ig-1',
      'page-token___user-token',
      [{ id: 'post-1', message: 'Hello', settings, media } as never],
      {} as never
    );
    return urls.filter((u) => /\/ig-1\/media\?/.test(u) && !u.includes('CAROUSEL'));
  };

  it('sends the alt text with a single image', async () => {
    const [url] = await containerUrls([{ path: 'https://cdn/x.jpg', alt: 'A red bus & a tree' }]);
    expect(url).toContain(`&alt_text=${encodeURIComponent('A red bus & a tree')}`);
  });

  it('sends each carousel image its own alt text', async () => {
    const urls = await containerUrls([
      { path: 'https://cdn/a.jpg', alt: 'first' },
      { path: 'https://cdn/b.jpg' },
    ]);
    expect(urls[0]).toContain('&alt_text=first');
    expect(urls[1]).not.toContain('alt_text');
  });

  it('leaves it out for videos and stories, which Instagram does not take it on', async () => {
    const [video] = await containerUrls([{ path: 'https://cdn/v.mp4', alt: 'clip' }]);
    expect(video).not.toContain('alt_text');
    const [story] = await containerUrls([{ path: 'https://cdn/s.jpg', alt: 'story' }], {
      post_type: 'story',
    });
    expect(story).not.toContain('alt_text');
  });

  it.each([
    ['Instagram', new InstagramProvider()],
    ['Instagram standalone', new InstagramStandaloneProvider()],
  ])('%s refuses alt text over the limit before the post goes out', async (_, provider) => {
    const media = (alt: string) => [[{ path: 'https://cdn/x.jpg', alt }]];
    await expect(provider.checkValidity(media('a'.repeat(IG_ALT_TEXT_MAX)), {})).resolves.toBe(true);
    await expect(
      provider.checkValidity(media('a'.repeat(IG_ALT_TEXT_MAX + 1)), {})
    ).resolves.toBe('Instagram alt text can be up to 1000 characters');
  });
});
