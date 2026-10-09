// Same module stubs as posts.analytics-days.spec.ts.
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

/**
 * TikTok only gives the public post id once moderation approves the post, so
 * a post published before that keeps its publish id and the profile as its
 * link. Post analytics ask the provider to resolve it first and store the
 * real id and link, so the calendar links the post and later reads skip the
 * lookup (upstream bcbc1195).
 */
const build = (resolved?: { postId: string; releaseURL: string }) => {
  const postAnalytics = jest.fn().mockResolvedValue([]);
  const resolveReleaseId = jest.fn().mockResolvedValue(resolved);
  const updateResolvedRelease = jest.fn().mockResolvedValue({});
  const service = new PostsService(
    {
      getPostById: jest.fn(async () => ({
        id: 'p1',
        releaseId: 'v_pub_url~v2-1.123',
        releaseURL: 'https://www.tiktok.com/@postra.co.uk',
        integration: {
          providerIdentifier: 'tiktok',
          internalId: 'i1',
          token: 'enc',
          tokenExpiration: new Date(Date.now() + 3600_000),
        },
      })),
      updateResolvedRelease,
    } as any,
    { getSocialIntegration: () => ({ postAnalytics, resolveReleaseId }) } as any,
    { disconnectChannel: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { refresh: jest.fn() } as any
  );
  return { service, postAnalytics, resolveReleaseId, updateResolvedRelease };
};

beforeEach(() => {
  jest
    .spyOn(AuthService, 'decryptIntegrationToken')
    .mockImplementation((v: string) => v);
});

describe('post analytics resolve the release id', () => {
  it('stores the resolved id and link and reads analytics for it', async () => {
    const { service, postAnalytics, updateResolvedRelease } = build({
      postId: '7558123456789011234',
      releaseURL: 'https://www.tiktok.com/@postra.co.uk/video/7558123456789011234',
    });

    await service.checkPostAnalytics('org', 'p1', 7);

    expect(updateResolvedRelease).toHaveBeenCalledWith(
      'p1',
      'org',
      '7558123456789011234',
      'https://www.tiktok.com/@postra.co.uk/video/7558123456789011234'
    );
    expect(postAnalytics.mock.calls[0][2]).toBe('7558123456789011234');
    expect(postAnalytics.mock.calls[0][4]).toBe(
      'https://www.tiktok.com/@postra.co.uk/video/7558123456789011234'
    );
  });

  it('keeps the stored id while there is nothing to resolve yet', async () => {
    const { service, postAnalytics, updateResolvedRelease } = build(undefined);

    await service.checkPostAnalytics('org', 'p1', 7);

    expect(updateResolvedRelease).not.toHaveBeenCalled();
    expect(postAnalytics.mock.calls[0][2]).toBe('v_pub_url~v2-1.123');
  });
});
