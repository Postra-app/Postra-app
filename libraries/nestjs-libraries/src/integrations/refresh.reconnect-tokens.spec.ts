jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { RefreshIntegrationService } from './refresh.integration.service';

// From upstream 49aa92ac (its main fix, the reconnect branch storing
// body.refresh, we already had as E2E-04-34): a reconnect whose provider
// sends no new refresh token (Google re-consent) wiped the stored one, and a
// failed refresh told the customer twice.
describe('reconnecting a channel keeps its refresh token', () => {
  const connect = async (refreshToken: string) => {
    const upsert = jest.fn().mockResolvedValue({ id: 'int-1', providerIdentifier: 'youtube' });
    const integration = { upsert, findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() };
    const repository = new IntegrationRepository({ model: { integration } } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await repository.createOrUpdateIntegration(undefined, false, 'org-1', 'Channel', undefined, 'social', 'int-1', 'youtube', 'access', refreshToken, 3600, 'user', false, 'refresh-id');
    return upsert.mock.calls[0][0].update;
  };

  it('an empty refresh token does not overwrite the stored one', async () => {
    expect(await connect('')).not.toHaveProperty('refreshToken');
  });

  it('a new refresh token replaces it', async () => {
    expect((await connect('new-refresh')).refreshToken).toBeTruthy();
  });
});

describe('a failed token refresh', () => {
  it('tells the customer once, with the reason', async () => {
    const notifications: string[] = [];
    const service = Object.create(IntegrationService.prototype) as IntegrationService;
    Object.assign(service, {
      _auditService: { record: jest.fn() },
      _integrationRepository: { disconnectChannel: jest.fn(), refreshNeeded: jest.fn() },
      _notificationService: {
        inAppNotification: jest.fn(async (_org: string, subject: string) => notifications.push(subject)),
      },
    });
    const refresh = new RefreshIntegrationService(
      { getSocialIntegration: () => ({}) } as any,
      service,
      {} as any
    );
    const provider = { refreshToken: jest.fn().mockRejectedValue(new Error('invalid_grant')) };

    await expect(
      (refresh as any).refreshProcess(
        { id: 'i1', organizationId: 'org-1', providerIdentifier: 'youtube', refreshToken: 'r', internalId: 'x', rootInternalId: 'x' },
        provider,
        '(publishing)'
      )
    ).resolves.toBe(false);

    expect(notifications).toEqual(['Could not refresh your youtube channel (publishing)']);
  });
});
