import 'reflect-metadata';

jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { IntegrationsController } = require('./integrations.controller');

// A YouTube or Google Business Profile channel that has not picked its page
// yet lists the pages with the token from the connect. That token lives an
// hour; after it, YouTube's listing swallowed the 401 and the picker said it
// found no channels (upstream 33876a3f1, 2f4f4e1e0, 38c432aa5). A channel
// still picking its page is refreshed first. Any other channel is called with
// its stored token: a stored date in the past does not mean the token stopped
// working (Facebook, Instagram), and a refresh that fails flags the channel.
describe('POST /integrations/function for a channel still picking its page', () => {
  const org = { id: 'org-1' } as any;
  const HOUR_AGO = new Date(Date.now() - 3_600_000);
  const IN_AN_HOUR = new Date(Date.now() + 3_600_000);

  const setup = (channel: Record<string, unknown>) => {
    const seen: { token: string; refreshToken?: string }[] = [];
    const provider = {
      async pages(token: string, _data: unknown, _id: string, integration: { refreshToken?: string }) {
        seen.push({ token, refreshToken: integration.refreshToken });
        return token === 'fresh' ? [{ id: 'UC1', name: 'Channel' }] : [];
      },
    };
    const refresh = jest.fn(async () => ({ accessToken: 'fresh', refreshToken: 'rotated' }));
    const controller = new IntegrationsController(
      { getSocialIntegration: () => provider } as any,
      {
        getIntegrationById: async () => ({
          token: 'from-connect',
          refreshToken: 'first',
          internalId: 'acc-1',
          providerIdentifier: 'youtube',
          ...channel,
        }),
      } as any,
      {} as any,
      { refresh } as any
    );
    return { controller, refresh, seen };
  };

  it('refreshes an expired token before listing the pages', async () => {
    const { controller, refresh, seen } = setup({ inBetweenSteps: true, tokenExpiration: HOUR_AGO });
    await expect(controller.functionIntegration(org, { id: 'ch-1', name: 'pages' })).resolves.toEqual([
      { id: 'UC1', name: 'Channel' },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The rotated refresh token travels with the channel, not the old one.
    expect(seen).toEqual([{ token: 'fresh', refreshToken: 'rotated' }]);
  });

  it('lists with the stored token while it is still valid', async () => {
    const { controller, refresh, seen } = setup({ inBetweenSteps: true, tokenExpiration: IN_AN_HOUR });
    await controller.functionIntegration(org, { id: 'ch-1', name: 'pages' });
    expect(refresh).not.toHaveBeenCalled();
    expect(seen[0].token).toBe('from-connect');
  });

  it('answers false when the refresh fails, without calling the platform', async () => {
    const { controller, refresh, seen } = setup({ inBetweenSteps: true, tokenExpiration: HOUR_AGO });
    refresh.mockResolvedValueOnce(false as any);
    await expect(controller.functionIntegration(org, { id: 'ch-1', name: 'pages' })).resolves.toBe(false);
    expect(seen).toEqual([]);
  });

  it('refreshes once per request even when the platform refuses the fresh token', async () => {
    const { controller, refresh } = setup({ inBetweenSteps: true, tokenExpiration: HOUR_AGO });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RefreshToken } = require('@gitroom/nestjs-libraries/integrations/social.abstract');
    const provider = {
      async pages() {
        throw new RefreshToken('youtube', '{"error":"invalid_token"}', '{}', 'expired');
      },
    };
    (controller as any)._integrationManager = { getSocialIntegration: () => provider };
    await expect(controller.functionIntegration(org, { id: 'ch-1', name: 'pages' })).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('calls a finished channel with its stored token, past its stored date too', async () => {
    const { controller, refresh, seen } = setup({ inBetweenSteps: false, tokenExpiration: HOUR_AGO });
    await controller.functionIntegration(org, { id: 'ch-1', name: 'pages' });
    expect(refresh).not.toHaveBeenCalled();
    expect(seen[0].token).toBe('from-connect');
  });
});
