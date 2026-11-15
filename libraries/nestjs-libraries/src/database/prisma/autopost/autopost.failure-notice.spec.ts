jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const keys = new Set<string>();
const redisSet = jest.fn(async (key: string) => {
  if (keys.has(key)) return null;
  keys.add(key);
  return 'OK';
});
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: (...a: unknown[]) => (redisSet as any)(...a) },
}));

import { AutopostService } from './autopost.service';

// A feed posting only to Instagram with the image credits used up cannot post
// its article, tries again every hour, and told the customer "Autopost
// failed" every hour: 24 identical notices a day until the cycle turned.
const channel = { id: 'ch-1', organizationId: 'org-1', providerIdentifier: 'instagram' };

const service = (url = 'https://blog.example/new') => {
  const s = Object.create(AutopostService.prototype) as any;
  s._autopostsRepository = {
    getAutopost: async () => ({
      id: 'ap-1',
      active: true,
      lastUrl: 'https://blog.example/old',
      url: 'https://blog.example/feed',
      organizationId: 'org-1',
      integrations: '[]',
      title: 'Blog',
      generateContent: false,
      content: 'Text',
      addPicture: false,
    }),
    updateUrl: jest.fn(),
  };
  s.loadNewLoads = async () => [{ url, date: new Date().toISOString(), description: 'New' }];
  s._integrationService = { getIntegrationsList: async () => [channel] };
  s._subscriptionService = { postCap: async (): Promise<null> => null };
  s._postsService = { createPost: jest.fn() };
  s._notificationService = { inAppNotification: jest.fn() };
  s.loadBrand = async (state: unknown) => state;
  return s;
};

beforeEach(() => {
  keys.clear();
  redisSet.mockClear();
});

it('an article that cannot be posted is reported once, not on every hourly run', async () => {
  const s = service();
  await s.startAutopost('ap-1');
  await s.startAutopost('ap-1');
  await s.startAutopost('ap-1');
  expect(s._notificationService.inAppNotification).toHaveBeenCalledTimes(1);
  expect(s._notificationService.inAppNotification.mock.calls[0][2]).toContain('needs an image');
  // Still not posted, and still tried: the cursor stays on the article.
  expect(s._postsService.createPost).not.toHaveBeenCalled();
  expect(s._autopostsRepository.updateUrl).not.toHaveBeenCalled();
  expect(redisSet.mock.calls[0].slice(1)).toEqual(['1', 'EX', 86_400, 'NX']);
});

it('the next article that fails is reported again', async () => {
  await service('https://blog.example/a').startAutopost('ap-1');
  const second = service('https://blog.example/b');
  await second.startAutopost('ap-1');
  expect(second._notificationService.inAppNotification).toHaveBeenCalledTimes(1);
});

it('with Redis away the notice still goes out', async () => {
  redisSet.mockRejectedValueOnce(new Error('redis down'));
  const s = service();
  await s.startAutopost('ap-1');
  expect(s._notificationService.inAppNotification).toHaveBeenCalledTimes(1);
});
