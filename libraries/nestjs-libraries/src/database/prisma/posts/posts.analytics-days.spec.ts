// Same module stubs as posts.refresh-retry.spec.ts: jsdom and nostr do not
// start here, and nothing in these tests needs them.
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
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn() },
}));

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * GET /public/v1/analytics/post/:id without `date` (E2E-08-57): the
 * controller passes `+date`, so the platform was asked for NaN days and the
 * result cached under "NaN". The docs promise 7 days, as channel analytics
 * already do (integration.service checkAnalytics).
 */
const build = () => {
  const postAnalytics = jest.fn().mockResolvedValue([{ label: 'Views', data: [] }]);
  const service = new PostsService(
    {
      getPostById: jest.fn(async () => ({
        id: 'p1',
        releaseId: 'r1',
        integration: {
          providerIdentifier: 'youtube',
          internalId: 'i1',
          token: 'enc',
          tokenExpiration: new Date(Date.now() + 3600_000),
        },
      })),
    } as any,
    { getSocialIntegration: () => ({ postAnalytics }) } as any,
    { disconnectChannel: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { refresh: jest.fn() } as any
  );
  return { service, postAnalytics };
};

beforeEach(() => {
  jest.spyOn(AuthService, 'decryptIntegrationToken').mockImplementation((v: string) => v);
  (ioRedis.set as jest.Mock).mockClear();
});

describe('post analytics days', () => {
  it.each([NaN, 0, -3])('%p days asks the platform for 7', async (date) => {
    const { service, postAnalytics } = build();
    await service.checkPostAnalytics('org', 'p1', date);
    expect(postAnalytics.mock.calls[0][3]).toBe(7);
    expect((ioRedis.set as jest.Mock).mock.calls[0][0]).toBe('integration:org:p1:7');
  });

  it('a given number of days is passed through', async () => {
    const { service, postAnalytics } = build();
    await service.checkPostAnalytics('org', 'p1', 30);
    expect(postAnalytics.mock.calls[0][3]).toBe(30);
  });
});
