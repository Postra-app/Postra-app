jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: () => Promise.resolve() }));

import { InstagramProvider } from './instagram.provider';

// Collaborators on an Instagram post (upstream a9aced7d, 0a8c28fb, 1de15370):
// Meta refuses them on carousel children ("param collaborators is not
// allowed"), wants them URL-encoded, and rejects a leading @ (2207018).
describe('Instagram collaborators', () => {
  const urls: string[] = [];
  const provider = new InstagramProvider();
  (provider as any).toInstagramSafeMedia = async (media: unknown[]) => media;
  (provider as any).fetch = async (url: string) => {
    urls.push(url);
    return { json: async () => ({ id: `id-${urls.length}`, status_code: 'FINISHED', permalink: 'https://instagram.com/p/x' }) };
  };
  beforeEach(() => (urls.length = 0));

  const post = (images: number) => [
    {
      id: 'p1',
      message: 'Hello',
      settings: { post_type: 'post', collaborators: [{ label: '@alice' }, { label: 'bob' }] },
      media: Array.from({ length: images }, (_, i) => ({ path: `https://cdn-dev.postra.pl/${i}.jpg` })),
    },
  ] as any;

  const encoded = encodeURIComponent(JSON.stringify(['alice', 'bob']));

  it('a carousel: on the container, not on the children', async () => {
    await provider.post('17841400000000001', 'token___user', post(2), {} as any);
    const children = urls.filter((u) => u.includes('is_carousel_item=true'));
    const container = urls.find((u) => u.includes('media_type=CAROUSEL'))!;
    expect(children).toHaveLength(2);
    for (const child of children) expect(child).not.toContain('collaborators');
    expect(container).toContain(`&collaborators=${encoded}`);
  });

  it('a single picture: on the item, encoded, without the @', async () => {
    await provider.post('17841400000000001', 'token___user', post(1), {} as any);
    expect(urls[0]).toContain(`&collaborators=${encoded}`);
    expect(urls.join(' ')).not.toContain('%40alice');
  });
});
