// nostr-tools is ESM and stops jest dead; it arrives through the integration
// manager, which this test only ever passes in as a stub anyway.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') },
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { decryptIntegrationToken: (t: string) => t },
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// A customer who removes the app on the platform side gets the channel
// flagged (red "!") the next time the channel list loads, but no notice or
// e-mail: only a failed token refresh sent "Could not refresh your … channel".
// Someone who is not looking at the list learns of it when posts start failing.

const channel = {
  id: 'i1',
  organizationId: 'org-1',
  providerIdentifier: 'facebook',
  internalId: 'page-1',
  token: 'token',
  disabled: false,
  refreshNeeded: false,
};

const build = (flagged: boolean) => {
  const repository = {
    getIntegrationsList: jest.fn().mockResolvedValue([channel]),
    refreshNeeded: jest.fn().mockResolvedValue(flagged),
  };
  const manager = {
    getSocialIntegration: jest.fn().mockReturnValue({ checkToken: jest.fn().mockResolvedValue(false) }),
  };
  const notifications = { inAppNotification: jest.fn() };
  const service = new IntegrationService(
    repository as any,
    {} as any, // autoposts
    manager as any,
    notifications as any,
    {} as any, // refresh integrations
    {} as any, // temporal
    {} as any // audit
  );
  return { service, repository, notifications };
};

describe('the channel health check', () => {
  it('tells the customer when it finds a revoked channel', async () => {
    const { service, repository, notifications } = build(true);
    await service.checkIntegrationsHealth('org-1');
    expect(repository.refreshNeeded).toHaveBeenCalledWith('org-1', 'i1');
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
    expect(notifications.inAppNotification.mock.calls[0][1]).toBe(
      'Could not refresh your facebook channel'
    );
  });

  it('does not tell again when the channel was already flagged', async () => {
    const { service, notifications } = build(false);
    await service.checkIntegrationsHealth('org-1');
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
  });
});
