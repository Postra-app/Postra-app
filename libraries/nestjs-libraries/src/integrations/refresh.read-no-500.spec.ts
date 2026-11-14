jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { RefreshIntegrationService } from './refresh.integration.service';

// The token refreshed, but the login no longer has the channel (YouTube
// "Channel not found"): the error went straight through the analytics read,
// a 500 on every load of the page (upstream #2048).
describe('analytics of a channel the refreshed login cannot find', () => {
  const channel = {
    id: 'i1',
    organizationId: 'org-1',
    type: 'social',
    providerIdentifier: 'youtube',
    internalId: 'channel-1',
    rootInternalId: 'google-account',
    refreshToken: 'r',
    token: 't',
    tokenExpiration: new Date(Date.now() - 60_000),
  } as any;
  const provider = {
    refreshToken: jest.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'r2', expiresIn: 3600 }),
    reConnect: jest.fn().mockRejectedValue(new Error('Channel not found')),
    analytics: jest.fn(),
  };
  const manager = { getSocialIntegration: () => provider };
  const build = () => {
    const service = Object.create(IntegrationService.prototype) as any;
    const refresh = new RefreshIntegrationService(manager as any, service, {} as any);
    Object.assign(service, {
      _integrationManager: manager,
      _refreshIntegrationService: refresh,
      _integrationRepository: { getIntegrationById: jest.fn().mockResolvedValue(channel) },
    });
    return { service: service as IntegrationService, refresh };
  };

  it('are empty, not an error', async () => {
    const { service } = build();
    await expect(service.checkAnalytics({ id: 'org-1' } as any, 'i1', '7')).resolves.toEqual([]);
    expect(provider.analytics).not.toHaveBeenCalled();
  });

  it('publishing still gets the reason, to tell the customer', async () => {
    const { refresh } = build();
    await expect(refresh.refresh(channel)).rejects.toThrow('Channel not found');
  });
});
