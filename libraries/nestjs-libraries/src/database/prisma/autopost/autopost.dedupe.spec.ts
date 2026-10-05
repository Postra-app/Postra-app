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

const build = (alreadyPosted: boolean) => {
  const posts = {
    hasRecentAutopost: jest.fn().mockResolvedValue(alreadyPosted),
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
  expect(posts.hasRecentAutopost).toHaveBeenCalledWith('org-1', ['ch-1'], 'https://blog.example/a?x=1&y=2');
  expect(posts.createPost).not.toHaveBeenCalled();
});

it('a new article is posted', async () => {
  const { service, posts } = build(false);
  await service.schedulePost(state('https://blog.example/b'));
  expect(posts.createPost).toHaveBeenCalledTimes(1);
});
