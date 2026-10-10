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
        inAppNotification: jest.fn(async (_org: string, _subject: string, message: string) => notifications.push(message)),
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

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain('Could not refresh your youtube channel (publishing)');
  });
});

describe('a YouTube refresh refused by a Workspace session policy', () => {
  // Google's answer when a Workspace admin forces re-authentication
  // (invalid_rapt): the generic notice sent customers to reconnect, again
  // and again, without saying why (upstream 49aa92ac).
  const raptError = Object.assign(new Error('invalid_grant'), {
    response: { data: { error: 'invalid_grant', error_description: 'reauth related error (invalid_rapt)', error_subtype: 'invalid_rapt' } },
  });

  it('tells the customer what their admin has to change', async () => {
    const { YoutubeProvider } = await import('./social/youtube.provider');
    const notifications: string[] = [];
    const service = Object.create(IntegrationService.prototype) as IntegrationService;
    Object.assign(service, {
      _auditService: { record: jest.fn() },
      _integrationRepository: { disconnectChannel: jest.fn(), refreshNeeded: jest.fn() },
      _notificationService: {
        inAppNotification: jest.fn(async (_org: string, _subject: string, message: string) => notifications.push(message)),
      },
    });
    const provider = new YoutubeProvider();
    jest.spyOn(provider, 'refreshToken').mockRejectedValue(raptError);
    const refresh = new RefreshIntegrationService({ getSocialIntegration: () => provider } as any, service, {} as any);

    await (refresh as any).refreshProcess(
      { id: 'i1', organizationId: 'org-1', providerIdentifier: 'youtube', refreshToken: 'r', internalId: 'x', rootInternalId: 'x' },
      provider,
      ''
    );

    expect(notifications[0]).toContain('Google Workspace');
    expect(notifications[0]).toContain('trusted app');
    expect(notifications).toHaveLength(1);
  });
});

// Upstream #1884: the reason sat in the notification's title too, so a long
// one (the Workspace advice above) became the e-mail subject.
describe('the refresh notice', () => {
  it('keeps the reason in the message, not the subject', async () => {
    const inAppNotification = jest.fn();
    const service = Object.create(IntegrationService.prototype) as IntegrationService;
    Object.assign(service, { _notificationService: { inAppNotification } });

    await service.informAboutRefreshError('org-1', { providerIdentifier: 'youtube' } as any, 'because of a policy');

    const [, subject, message] = inAppNotification.mock.calls[0];
    expect(subject).toBe('Could not refresh your youtube channel');
    expect(message).toContain('because of a policy');
  });
});
