// PostsService reaches isomorphic-dompurify through the create-post DTO, and
// that pulls jsdom, which does not start in this repo. Nothing here sanitizes.
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
  ioRedis: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

// Facebook and Instagram (through a Facebook Page) store a 59-day expiry when
// a page is picked, but a page token does not expire on that date and cannot
// be refreshed: their refreshToken() returns an empty token. The analytics
// paths refreshed on the stored date, so once it passed, opening analytics
// flagged a healthy channel, disconnected it and emailed the customer to
// reconnect (upstream 82121e28c). A token the platform rejects still goes
// through the refresh
// (forceRefresh), and providers with a real refresh are unchanged.

const PAST = new Date(Date.now() - 86_400_000);

describe('Facebook and Instagram are not refreshed on their stored expiry', () => {
  it('both providers say so', () => {
    expect(new FacebookProvider().noRefreshBeforeCall).toBe(true);
    expect(new InstagramProvider().noRefreshBeforeCall).toBe(true);
  });
});

const channelAnalytics = (provider: Record<string, unknown>) => {
  const analytics = jest.fn().mockResolvedValue([{ label: 'Views', data: [] }]);
  const refresh = { refreshForRead: jest.fn().mockResolvedValue(false) };
  const service = new IntegrationService(
    {} as any,
    {} as any,
    { getSocialIntegration: () => ({ ...provider, analytics }) } as any,
    {} as any,
    refresh as any,
    {} as any,
    {} as any
  );
  jest.spyOn(service, 'getIntegrationById').mockResolvedValue({
    id: 'ch-1',
    internalId: 'page-1',
    token: 'page-token',
    type: 'social',
    providerIdentifier: 'facebook',
    tokenExpiration: PAST,
  } as any);
  return { service, analytics, refresh };
};

describe('channel analytics after the stored expiry', () => {
  afterEach(() => jest.clearAllMocks());

  it('a Facebook Page loads its analytics with its token, no refresh', async () => {
    const { service, analytics, refresh } = channelAnalytics({ noRefreshBeforeCall: true });
    await service.checkAnalytics({ id: 'org-1' } as any, 'ch-1', '7');
    expect(refresh.refreshForRead).not.toHaveBeenCalled();
    expect(analytics).toHaveBeenCalledWith('page-1', 'page-token', 7);
  });

  it('a token the platform rejected is still refreshed', async () => {
    const { service, refresh } = channelAnalytics({ noRefreshBeforeCall: true });
    await service.checkAnalytics({ id: 'org-1' } as any, 'ch-1', '7', true);
    expect(refresh.refreshForRead).toHaveBeenCalledTimes(1);
  });

  it('a provider with a real refresh still refreshes on its stored expiry', async () => {
    const { service, refresh } = channelAnalytics({});
    await service.checkAnalytics({ id: 'org-1' } as any, 'ch-1', '7');
    expect(refresh.refreshForRead).toHaveBeenCalledTimes(1);
  });
});

const postService = (
  provider: Record<string, unknown>,
  integration: Record<string, unknown> = {}
) => {
  const postAnalytics = jest.fn().mockResolvedValue([{ label: 'Likes', data: [] }]);
  const missing = jest.fn().mockResolvedValue([]);
  const refresh = { refreshForRead: jest.fn().mockResolvedValue(false) };
  const post = (releaseId: string) => ({
    id: 'post-1',
    releaseId,
    integration: {
      id: 'ch-1',
      internalId: 'page-1',
      token: 'page-token',
      providerIdentifier: 'facebook',
      tokenExpiration: PAST,
      deletedAt: null,
      ...integration,
    },
  });
  let releaseId = 'release-1';
  const service = new PostsService(
    { getPostById: jest.fn(async () => post(releaseId)) } as any,
    { getSocialIntegration: () => ({ ...provider, postAnalytics, missing }) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    refresh as any
  );
  return {
    service,
    postAnalytics,
    missing,
    refresh,
    missingRelease: () => {
      releaseId = 'missing';
    },
  };
};

describe('post analytics and missing content after the stored expiry', () => {
  afterEach(() => jest.clearAllMocks());

  it('a Facebook post loads its analytics with the page token, no refresh', async () => {
    const { service, postAnalytics, refresh } = postService({ noRefreshBeforeCall: true });
    await service.checkPostAnalytics('org-1', 'post-1', 7);
    expect(refresh.refreshForRead).not.toHaveBeenCalled();
    expect(postAnalytics).toHaveBeenCalled();
  });

  it('a Facebook post with missing content is looked up without a refresh', async () => {
    const { service, missing, refresh, missingRelease } = postService({
      noRefreshBeforeCall: true,
    });
    missingRelease();
    await service.getMissingContent('org-1', 'post-1');
    expect(refresh.refreshForRead).not.toHaveBeenCalled();
    expect(missing).toHaveBeenCalled();
  });

  it('a post on a deleted channel answers empty, with no refresh and no platform call', async () => {
    const { service, postAnalytics, refresh } = postService({}, { deletedAt: new Date() });
    expect(await service.checkPostAnalytics('org-1', 'post-1', 7)).toEqual([]);
    expect(refresh.refreshForRead).not.toHaveBeenCalled();
    expect(postAnalytics).not.toHaveBeenCalled();
  });
});

describe('the manual refresh command', () => {
  it('leaves Facebook and Instagram alone instead of flagging them', async () => {
    const repository = {
      needsToBeRefreshed: jest.fn().mockResolvedValue([
        {
          id: 'fb',
          name: 'Page',
          providerIdentifier: 'facebook',
          organizationId: 'org-1',
          refreshToken: 'r',
          tokenExpiration: PAST,
        },
      ]),
      refreshNeeded: jest.fn(),
    };
    const service = new IntegrationService(
      repository as any,
      {} as any,
      { getSocialIntegration: () => new FacebookProvider() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const report = await service.refreshTokens(true);
    expect(repository.refreshNeeded).not.toHaveBeenCalled();
    expect(report.failed).toEqual([]);
    expect(report.refreshed).toEqual([]);
  });
});
