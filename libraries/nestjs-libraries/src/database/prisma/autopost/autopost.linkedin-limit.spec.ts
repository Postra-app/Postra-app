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

import { BadRequestException } from '@nestjs/common';
import { AutopostService } from './autopost.service';
import { LINKEDIN_PAGES_LIMITS_MESSAGE } from '@gitroom/nestjs-libraries/integrations/linkedin-pages.limits';

// A LinkedIn Page in early access takes one post a day. The AWS feed of our
// own workspace met a Page that had already posted and told us "Autopost
// failed" with the limit's text in the middle: it read as a lost post. And a
// feed that also posts to X waited for the Page with every other channel.
const page = { id: 'ch-page', organizationId: 'org-1', providerIdentifier: 'linkedin-page' };
const x = { id: 'ch-x', organizationId: 'org-1', providerIdentifier: 'x' };

const service = (channels: object[], url = 'https://blog.example/new') => {
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
      onSlot: false,
    }),
    updateUrl: jest.fn(),
  };
  s.loadNewLoads = async () => [{ url, date: new Date().toISOString(), description: 'New' }];
  s._integrationService = { getIntegrationsList: async () => channels };
  s._subscriptionService = { postCap: async (): Promise<null> => null };
  s._postsService = {
    channelsWithRecentAutopost: async () => new Set<string>(),
    // The Page has its post for the day: any request that includes it fails.
    createPost: jest.fn(async (_org: string, body: any) => {
      if (body.posts.some((p: any) => p.integration.id === page.id)) {
        throw new BadRequestException(LINKEDIN_PAGES_LIMITS_MESSAGE);
      }
    }),
  };
  s._notificationService = { inAppNotification: jest.fn() };
  s.loadBrand = async (state: unknown) => state;
  return s;
};

const postedTo = (s: any) =>
  s._postsService.createPost.mock.calls.flatMap((c: any[]) =>
    c[1].posts.map((p: any) => p.integration.id)
  );

beforeEach(() => {
  keys.clear();
  redisSet.mockClear();
});

it('a Page at its daily limit gets a notice that says so, by email, not "Autopost failed"', async () => {
  const s = service([page]);
  await s.startAutopost('ap-1');
  expect(s._notificationService.inAppNotification).toHaveBeenCalledTimes(1);
  const [org, subject, message, email, digest, type] =
    s._notificationService.inAppNotification.mock.calls[0];
  expect(org).toBe('org-1');
  expect(subject).toBe('Auto-post waiting: LinkedIn Page daily limit');
  expect(message).toContain('one post a day');
  expect(message).toContain('Nothing is lost');
  expect(message).not.toContain('could not publish');
  expect([email, digest, type]).toEqual([true, false, 'info']);
  // The article is kept for the next run.
  expect(s._autopostsRepository.updateUrl).not.toHaveBeenCalled();
});

it('the notice goes out once per article, not on every hourly run', async () => {
  const s = service([page]);
  await s.startAutopost('ap-1');
  await s.startAutopost('ap-1');
  await s.startAutopost('ap-1');
  expect(s._notificationService.inAppNotification).toHaveBeenCalledTimes(1);
  expect(redisSet.mock.calls[0][0]).toMatch(/^autopost-linkedin-limit:ap-1:/);
  expect(redisSet.mock.calls[0].slice(1)).toEqual(['1', 'EX', 7 * 86_400, 'NX']);
});

it('the other channels of the feed post now; only the Page waits', async () => {
  const s = service([page, x]);
  await s.startAutopost('ap-1');
  // Together first, then each channel on its own after the Page's refusal.
  expect(postedTo(s)).toEqual(['ch-page', 'ch-x', 'ch-page', 'ch-x']);
  // Three requests: both, the Page alone (refused), X alone (written).
  expect(s._postsService.createPost).toHaveBeenCalledTimes(3);
  await expect(s._postsService.createPost.mock.results[2].value).resolves.toBeUndefined();
  // The Page still lacks the article, so the cursor stays on it.
  expect(s._autopostsRepository.updateUrl).not.toHaveBeenCalled();
  expect(s._notificationService.inAppNotification.mock.calls[0][1]).toBe(
    'Auto-post waiting: LinkedIn Page daily limit'
  );
});

it('any other error is still "Autopost failed"', async () => {
  const s = service([x]);
  s._postsService.createPost = jest.fn(async () => {
    throw new Error('X said no');
  });
  await s.startAutopost('ap-1');
  const [, subject, message, email, , type] =
    s._notificationService.inAppNotification.mock.calls[0];
  expect(subject).toBe('Autopost failed');
  expect(message).toContain('X said no');
  expect([email, type]).toEqual([false, 'fail']);
});
