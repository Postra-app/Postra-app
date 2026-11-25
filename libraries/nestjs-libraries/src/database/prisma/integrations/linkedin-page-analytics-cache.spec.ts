jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
const store = new Map<string, { value: string; ttl: number }>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async (k: string) => store.get(k)?.value ?? null),
    set: jest.fn(async (k: string, value: string, _ex: string, ttl: number) => {
      store.set(k, { value, ttl });
      return 'OK';
    }),
  },
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { LinkedinPageProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider';

// LinkedIn Pages run on a Development Tier of 500 API calls a day for the
// whole app. Page analytics cost 3 calls and a post's statistics 2; the post
// path wrote its cache but never read it, so every open of a post's
// statistics spent the shared budget again, and page analytics were kept an
// hour. A provider with a daily budget keeps both for six hours; the others
// are unchanged (page analytics an hour, post statistics live).

const SIX_HOURS = 6 * 60 * 60;

beforeEach(() => {
  store.clear();
  process.env.NODE_ENV = 'production';
});

it('LinkedIn Page keeps analytics for six hours', () => {
  expect(new LinkedinPageProvider().analyticsCacheSeconds).toBe(SIX_HOURS);
});

const channel = (provider: Record<string, unknown>) => {
  const analytics = jest.fn().mockResolvedValue([{ label: 'Impressions', data: [] }]);
  const service = new IntegrationService(
    {} as any,
    {} as any,
    { getSocialIntegration: () => ({ ...provider, analytics }) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  jest.spyOn(service, 'getIntegrationById').mockResolvedValue({
    id: 'ch-1',
    internalId: 'org-page',
    token: 't',
    type: 'social',
    providerIdentifier: 'linkedin-page',
    tokenExpiration: new Date(Date.now() + 86_400_000),
  } as any);
  return { service, analytics };
};

describe('page analytics', () => {
  it('a LinkedIn Page is cached for six hours', async () => {
    const { service } = channel({ analyticsCacheSeconds: SIX_HOURS });
    await service.checkAnalytics({ id: 'org-1' } as any, 'ch-1', '7');
    expect(store.get('integration:org-1:ch-1:7')?.ttl).toBe(SIX_HOURS);
  });

  it('other platforms keep the hour they had', async () => {
    const { service } = channel({});
    await service.checkAnalytics({ id: 'org-1' } as any, 'ch-1', '7');
    expect(store.get('integration:org-1:ch-1:7')?.ttl).toBe(3600);
  });
});

const post = (provider: Record<string, unknown>) => {
  const postAnalytics = jest.fn().mockResolvedValue([{ label: 'Likes', data: [] }]);
  const service = new PostsService(
    {
      getPostById: jest.fn(async () => ({
        id: 'post-1',
        releaseId: 'urn:li:share:1',
        integration: {
          id: 'ch-1',
          internalId: 'org-page',
          token: 't',
          providerIdentifier: 'linkedin-page',
          tokenExpiration: new Date(Date.now() + 86_400_000),
          deletedAt: null,
        },
      })),
    } as any,
    { getSocialIntegration: () => ({ ...provider, postAnalytics }) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { service, postAnalytics };
};

describe('post statistics', () => {
  it('a LinkedIn Page post asks LinkedIn once in six hours', async () => {
    const { service, postAnalytics } = post({ analyticsCacheSeconds: SIX_HOURS });
    await service.checkPostAnalytics('org-1', 'post-1', 7);
    await service.checkPostAnalytics('org-1', 'post-1', 7);
    expect(postAnalytics).toHaveBeenCalledTimes(1);
    expect(store.get('integration:org-1:post-1:7')?.ttl).toBe(SIX_HOURS);
  });

  it('an empty answer is asked again, not kept for six hours', async () => {
    const { service, postAnalytics } = post({ analyticsCacheSeconds: SIX_HOURS });
    postAnalytics.mockResolvedValueOnce([]);
    expect(await service.checkPostAnalytics('org-1', 'post-1', 7)).toEqual([]);
    await service.checkPostAnalytics('org-1', 'post-1', 7);
    expect(postAnalytics).toHaveBeenCalledTimes(2);
  });

  it('other platforms still load live statistics every time', async () => {
    const { service, postAnalytics } = post({});
    await service.checkPostAnalytics('org-1', 'post-1', 7);
    await service.checkPostAnalytics('org-1', 'post-1', 7);
    expect(postAnalytics).toHaveBeenCalledTimes(2);
  });
});
