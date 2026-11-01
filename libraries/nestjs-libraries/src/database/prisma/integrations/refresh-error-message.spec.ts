jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// The reason comes from the provider and often ends with a full stop
// ("…application password."), which the message used to follow with its own
// ". Please go back": the notification and e-mail read "password.. Please".
describe('IntegrationService.informAboutRefreshError', () => {
  const send = async (reason?: string) => {
    const s = Object.create(IntegrationService.prototype) as IntegrationService;
    const inAppNotification = jest.fn();
    (s as any)._notificationService = { inAppNotification };
    await s.informAboutRefreshError(
      'org-1',
      { providerIdentifier: 'wordpress' } as any,
      reason
    );
    return inAppNotification.mock.calls[0][2] as string;
  };

  it('does not double the full stop after a reason that has one', async () => {
    const message = await send('Create a new application password.');
    expect(message).toContain(
      'channel Create a new application password. Please go back'
    );
    expect(message).not.toContain('..');
  });

  it('ends a reason without a full stop with one', async () => {
    expect(await send('Token expired')).toContain(
      'channel Token expired. Please go back'
    );
  });

  it('reads cleanly without a reason', async () => {
    expect(await send()).toContain(
      'Could not refresh your wordpress channel. Please go back'
    );
  });
});
