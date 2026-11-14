// nostr-tools is ESM and stops jest dead; it arrives through the integration
// manager, which these tests only ever pass in as a stub anyway.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { decryptIntegrationToken: (t: string) => t },
}));

import { RefreshIntegrationService } from './refresh.integration.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// A token refresh went through the connect path: it handed the channel's
// stored avatar (our own CDN copy) to createOrUpdateIntegration, which
// downloaded it and uploaded it again as a new file, and it wrote
// `integration.connect` to the audit log although nobody connected anything.
// A YouTube access token lives an hour, so every publish or analytics read
// after that added another copy and another false "connect".

const channel = {
  id: 'i1',
  organizationId: 'org-1',
  name: 'Channel',
  picture: 'https://cdn.example/2026/11/01/avatar.jpg',
  providerIdentifier: 'youtube',
  internalId: 'yt-1',
  rootInternalId: 'yt-1',
  refreshToken: 'old-refresh',
} as any;

const tokens = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 };

describe('a token refresh', () => {
  it('saves the new tokens, not a new connect', async () => {
    const integrations = {
      getIntegrationById: jest.fn().mockResolvedValue(channel),
      createOrUpdateIntegration: jest.fn(),
      saveRefreshedTokens: jest.fn(),
    };
    const provider = { refreshToken: jest.fn().mockResolvedValue(tokens) };
    const service = new RefreshIntegrationService(
      { getSocialIntegration: () => provider } as any,
      integrations as any,
      {} as any
    );

    expect(await service.refresh(channel)).toEqual(tokens);
    expect(integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
    expect(integrations.saveRefreshedTokens).toHaveBeenCalledWith(channel, false, tokens);
  });

  it('keeps the stored avatar and writes nothing to the audit log', async () => {
    const repository = { createOrUpdateIntegration: jest.fn().mockResolvedValue({}) };
    const audit = { record: jest.fn() };
    const service = new IntegrationService(
      repository as any,
      {} as any, // autoposts
      {} as any, // manager
      {} as any, // notifications
      {} as any, // refresh integrations
      {} as any, // temporal
      audit as any
    );
    const upload = jest.fn();
    (service as any).storage = { uploadSimple: upload };

    await service.saveRefreshedTokens(channel, false, tokens);

    expect(upload).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    const args = repository.createOrUpdateIntegration.mock.calls[0];
    expect(args[2]).toBe('org-1');
    expect(args[4]).toBeUndefined(); // picture: the repository keeps the stored one
    expect(args.slice(6, 11)).toEqual(['yt-1', 'youtube', 'new-access', 'new-refresh', 3600]);
  });
});
