jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { AutopostService } from './autopost.service';

/**
 * AI-2 — the post and the feed's cursor are two writes. A worker killed
 * between them left the cursor behind, and the retry posted the same article
 * again.
 */
const state = (url: string) =>
  ({
    id: 'feed-1',
    body: { onSlot: false },
    load: { url },
    description: 'text',
    platformContent: {},
    integrations: [{ id: 'ch-1', organizationId: 'org-1', providerIdentifier: 'x' }],
  }) as any;

const build = (alreadyPosted: boolean | string[]) => {
  const done = alreadyPosted === true ? ['ch-1'] : alreadyPosted === false ? [] : alreadyPosted;
  const posts = {
    channelsWithRecentAutopost: jest.fn().mockResolvedValue(new Set(done)),
    createPost: jest.fn().mockResolvedValue([]),
    findFreeDateTime: jest.fn(),
  };
  const service = Object.create(AutopostService.prototype) as AutopostService;
  (service as any)._postsService = posts;
  return { service, posts };
};

it('an article already posted from this feed is not posted again', async () => {
  const { service, posts } = build(true);
  await service.schedulePost(state('https://blog.example/a?x=1&y=2'));
  expect(posts.channelsWithRecentAutopost).toHaveBeenCalledWith('org-1', ['ch-1'], 'https://blog.example/a?x=1&y=2');
  expect(posts.createPost).not.toHaveBeenCalled();
});

it('a new article is posted', async () => {
  const { service, posts } = build(false);
  await service.schedulePost(state('https://blog.example/b'));
  expect(posts.createPost).toHaveBeenCalledTimes(1);
});

// AI-4: with every channel needing an image and none made, the article was
// skipped and the cursor moved past it for good.
it('an article that cannot get the image its channels need is kept for the next run', async () => {
  const { service, posts } = build(false);
  const instagramOnly = {
    ...state('https://blog.example/c'),
    image: null,
    integrations: [{ id: 'ig-1', organizationId: 'org-1', providerIdentifier: 'instagram' }],
  };
  await expect(service.schedulePost(instagramOnly)).rejects.toThrow(/needs an image/);
  expect(posts.createPost).not.toHaveBeenCalled();
});

// Codex review: one channel having the article skipped the others too.
it('only the channels that already have the article are left out', async () => {
  const { service, posts } = build(['ch-1']);
  const twoChannels = {
    ...state('https://blog.example/d'),
    integrations: [
      { id: 'ch-1', organizationId: 'org-1', providerIdentifier: 'mastodon' },
      { id: 'ch-2', organizationId: 'org-1', providerIdentifier: 'telegram' },
    ],
  };
  await service.schedulePost(twoChannels);
  expect(posts.createPost).toHaveBeenCalledTimes(1);
  const sent = posts.createPost.mock.calls[0][1].posts.map((p: any) => p.integration.id);
  expect(sent).toEqual(['ch-2']);
});
