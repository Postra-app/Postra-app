// Same module stubs as get-post-missing.spec.ts: jsdom and nostr do not start
// here, and nothing in these tests needs them.
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
// Analytics are cached in Redis; there is none here.
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn() },
}));

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

/**
 * Post analytics and the "missing content" lookup refresh the channel token
 * when the platform answers 401 and try again. The retry had no bound: when
 * the platform kept refusing after a successful refresh (a revoked scope,
 * a suspended app), both recursed for ever, calling the platform's refresh
 * endpoint on every turn while the request hung. Channel analytics in
 * IntegrationService already stopped after one retry; these two now match.
 */
const build = (provider: any) => {
  const refresh = jest.fn().mockResolvedValue({ accessToken: 'fresh' });
  const post = {
    id: 'p1',
    releaseId: 'missing',
    integration: {
      providerIdentifier: 'youtube',
      internalId: 'i1',
      token: 'enc',
      refreshToken: null,
      tokenExpiration: new Date(Date.now() + 3600_000),
    },
  };
  const service = new PostsService(
    { getPostById: jest.fn(async () => ({ ...post, integration: { ...post.integration } })) } as any,
    { getSocialIntegration: () => provider } as any,
    { disconnectChannel: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { refresh } as any
  );
  return { service, refresh };
};

const refused = () => new RefreshToken('youtube', '{}', '', '401');

beforeEach(() => {
  jest.spyOn(AuthService, 'decryptIntegrationToken').mockImplementation((v: string) => v);
});

describe('background reads retry a refused token once', () => {
  it('missing content: one refresh, then gives up with []', async () => {
    const missing = jest.fn().mockRejectedValue(refused());
    const { service, refresh } = build({ missing });
    await expect(service.getMissingContent('org', 'p1')).resolves.toEqual([]);
    expect(missing).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('post analytics: one refresh, then gives up with []', async () => {
    const postAnalytics = jest.fn().mockRejectedValue(refused());
    const { service, refresh } = build({ postAnalytics });
    // A published post, so analytics are read.
    jest
      .spyOn((service as any)._postRepository, 'getPostById')
      .mockResolvedValue({
        id: 'p1',
        releaseId: 'r1',
        integration: { providerIdentifier: 'youtube', internalId: 'i1', token: 'enc', tokenExpiration: new Date(Date.now() + 3600_000) },
      });
    await expect(service.checkPostAnalytics('org', 'p1', 7)).resolves.toEqual([]);
    expect(postAnalytics).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('post analytics: the retry with the fresh token answers', async () => {
    const postAnalytics = jest
      .fn()
      .mockRejectedValueOnce(refused())
      .mockResolvedValueOnce([{ label: 'Views', data: [] }]);
    const { service } = build({ postAnalytics });
    jest
      .spyOn((service as any)._postRepository, 'getPostById')
      .mockResolvedValue({
        id: 'p1',
        releaseId: 'r1',
        integration: { providerIdentifier: 'youtube', internalId: 'i1', token: 'enc', tokenExpiration: new Date(Date.now() + 3600_000) },
      });
    await expect(service.checkPostAnalytics('org', 'p1', 7)).resolves.toEqual([{ label: 'Views', data: [] }]);
    expect(postAnalytics.mock.calls[1][1]).toBe('fresh');
  });
});
