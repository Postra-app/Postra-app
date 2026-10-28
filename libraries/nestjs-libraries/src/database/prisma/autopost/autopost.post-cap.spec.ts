jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { AutopostService } from './autopost.service';

// Auto Post wrote posts past the plan's posts a month (createPost
// without a cap), a trial's 30 and Starter's 400 alike. The run now asks
// before the AI writes anything, and the write checks again.
const cap = { anchor: new Date('2026-10-10T10:00:00Z'), limit: 30 };
const channel = { id: 'ch-1', organizationId: 'org-1', providerIdentifier: 'linkedin' };

const service = (reached: boolean) => {
  const s = Object.create(AutopostService.prototype) as any;
  s._autopostsRepository = {
    getAutopost: async () => ({ id: 'ap-1', active: true, lastUrl: 'https://blog.example/old', url: 'https://blog.example/feed', organizationId: 'org-1', integrations: '[]', title: 'Blog' }),
    updateUrl: jest.fn(),
  };
  s.loadNewLoads = async () => [{ url: 'https://blog.example/new', date: new Date().toISOString(), description: 'New' }];
  s._integrationService = { getIntegrationsList: async () => [channel] };
  s._subscriptionService = { postCap: jest.fn(async () => cap) };
  s._postsService = {
    postCapReached: jest.fn(async () => reached),
    channelsWithRecentAutopost: async () => new Set(),
    findFreeDateTime: async () => '2026-10-20T10:00:00',
    createPost: jest.fn(async () => []),
  };
  s._notificationService = { inAppNotification: jest.fn() };
  s.loadBrand = jest.fn(async () => ({}));
  return s;
};

it('stops before the AI writes anything when the month’s posts are used up', async () => {
  const s = service(true);
  await s.startAutopost('ap-1');
  expect(s._postsService.postCapReached).toHaveBeenCalledWith('org-1', cap.anchor, 30, [{}]);
  expect(s.loadBrand).not.toHaveBeenCalled();
  expect(s._autopostsRepository.updateUrl).not.toHaveBeenCalled();
});

it('goes on while there is room', async () => {
  const s = service(false);
  await s.startAutopost('ap-1').catch(() => undefined);
  expect(s.loadBrand).toHaveBeenCalled();
});

it('writes the post with the cap, so the transaction checks it again', async () => {
  const s = service(false);
  await s.schedulePost({
    body: { onSlot: true },
    integrations: [channel],
    load: { url: 'https://blog.example/new' },
    description: 'New',
    platformContent: {},
    image: null,
  });
  expect(s._postsService.createPost.mock.calls[0][2]).toBe('AUTOPOST');
  expect(s._postsService.createPost.mock.calls[0][3]).toBe(cap);
});
