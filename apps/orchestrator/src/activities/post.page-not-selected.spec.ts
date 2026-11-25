jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('@gitroom/nestjs-libraries/chat/auth.context', () => ({ checkAuth: (): void => undefined }));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationListTool } from '@gitroom/nestjs-libraries/chat/tools/integration.list.tool';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { GmbProvider } from '@gitroom/nestjs-libraries/integrations/social/gmb.provider';
import { LinkedinPageProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';
import { PAGE_NOT_SELECTED, PostActivity } from './post.activity';

// A Facebook, Instagram, Google Business Profile or LinkedIn Page channel
// whose id is still the account id of the login step never had its page
// picked. A post to it went out and came back with the platform's error; an
// assistant over MCP was offered such a channel as usable (upstream
// 32a6d0e64). YouTube posts to the token's own channel and is not blocked.

const service = (provider: object) =>
  new IntegrationService(
    {} as any,
    {} as any,
    { getSocialIntegration: () => provider } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

describe('channels that need a picked page to publish', () => {
  it('are Facebook, Instagram, Google Business Profile and LinkedIn Page, not YouTube', () => {
    expect(new FacebookProvider().pageRequiredToPost).toBe(true);
    expect(new InstagramProvider().pageRequiredToPost).toBe(true);
    expect(new GmbProvider().pageRequiredToPost).toBe(true);
    expect(new LinkedinPageProvider().pageRequiredToPost).toBe(true);
    expect((new YoutubeProvider() as { pageRequiredToPost?: boolean }).pageRequiredToPost).toBeFalsy();
  });
});

describe('publishing to a channel whose page was never picked', () => {
  const run = (channel: Record<string, unknown>) => {
    jest.spyOn(AuthService, 'decryptIntegrationToken').mockImplementation((v: any) => v);
    delete process.env.STRIPE_SECRET_KEY;
    const provider = Object.assign(new FacebookProvider(), {
      post: jest.fn().mockResolvedValue([{ id: 'p1', postId: 'r1', releaseURL: 'https://facebook.test/r1' }]),
    });
    const activity = Object.create(PostActivity.prototype) as any;
    Object.assign(activity, {
      _logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
      _integrationManager: { getSocialIntegration: () => provider },
      _integrationService: service(provider),
      _postService: {
        getPostById: jest.fn().mockResolvedValue({ id: 'p1', releaseId: null }),
        updateTags: jest.fn().mockResolvedValue([{ id: 'p1', content: 'Hi', settings: '{}', image: '[]' }]),
        updateMedia: jest.fn().mockResolvedValue([]),
        updatePost: jest.fn().mockResolvedValue(undefined),
      },
      _temporalService: { client: { getRawClient: () => ({ workflow: { start: jest.fn() } }) } },
    });
    const body = activity.postSocialBody(
      { id: 'i1', organizationId: 'o1', providerIdentifier: 'facebook', token: 't', refreshToken: null, ...channel },
      [{ id: 'p1', content: 'Hi', settings: '{}', image: '[]' }]
    );
    return { body, provider };
  };

  it('fails before the platform is called, telling the customer what to do', async () => {
    const { body, provider } = run({ internalId: 'account-1', rootInternalId: 'account-1' });
    await expect(body).rejects.toMatchObject({ type: 'bad_body', message: PAGE_NOT_SELECTED });
    expect(provider.post).not.toHaveBeenCalled();
  });

  it('publishes to a channel that picked its page', async () => {
    const { body, provider } = run({ internalId: 'page-1', rootInternalId: 'account-1' });
    await body;
    expect(provider.post).toHaveBeenCalledTimes(1);
  });
});

describe('the MCP channel list', () => {
  it('offers only channels a post can go to', async () => {
    const integrations = service(new FacebookProvider());
    jest.spyOn(integrations, 'getIntegrationsList').mockResolvedValue([
      { id: 'ok', name: 'Page', providerIdentifier: 'facebook', internalId: 'page-1', rootInternalId: 'acc-1' },
      { id: 'mid-connect', name: 'Page', providerIdentifier: 'facebook', internalId: 'acc-2', rootInternalId: 'acc-2', inBetweenSteps: true },
      { id: 'never-picked', name: 'Page', providerIdentifier: 'facebook', internalId: 'acc-3', rootInternalId: 'acc-3' },
      { id: 'off', name: 'Page', providerIdentifier: 'facebook', internalId: 'page-4', rootInternalId: 'acc-4', disabled: true },
    ] as any);
    const tool = new IntegrationListTool(integrations).run() as any;
    const context = { requestContext: { get: () => JSON.stringify({ id: 'org-1' }) } };
    const { output } = await tool.execute({}, context);
    expect(output.map((c: { id: string }) => c.id)).toEqual(['ok']);
  });
});
