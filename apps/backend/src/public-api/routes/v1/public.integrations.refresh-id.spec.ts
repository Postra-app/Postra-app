jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
  },
}));

import { HttpException } from '@nestjs/common';
import { PublicIntegrationsController } from './public.integrations.controller';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// The SDK and the docs say `GET /social/:platform?refresh=` takes the channel's
// id, the one GET /integrations lists. The route compared it with the
// platform's account id (internalId), which the API never shows, so every
// reconnect through the API answered 404. Both ids now name the channel, and
// the callback still gets the platform account id it checks against.
describe('public API reconnect by channel id', () => {
  const channel = {
    id: 'postra-channel-1',
    internalId: 'li-account-9',
    providerIdentifier: 'linkedin',
  };
  const integrationService = Object.create(IntegrationService.prototype);
  integrationService._integrationRepository = {
    getIntegrationsList: async () => [channel],
  };
  const manager = {
    getAllowedSocialsIntegrations: () => ['linkedin'],
    isOffered: () => true,
    getSocialIntegration: () => ({
      generateAuthUrl: async () => ({ codeVerifier: 'v', state: 'st', url: 'https://auth' }),
    }),
  };
  const controller = new PublicIntegrationsController(
    integrationService,
    {} as any,
    {} as any,
    {} as any,
    manager as any,
    {} as any,
    {} as any
  );
  const org = { id: 'org-1' } as any;

  beforeEach(() => store.clear());

  it('takes the Postra channel id and hands the callback the account id', async () => {
    await expect(
      controller.getIntegrationUrl('linkedin', 'postra-channel-1', org)
    ).resolves.toEqual({ url: 'https://auth' });
    expect(store.get('refresh:st')).toBe('li-account-9');
  });

  it('still takes the platform account id', async () => {
    await controller.getIntegrationUrl('linkedin', 'li-account-9', org);
    expect(store.get('refresh:st')).toBe('li-account-9');
  });

  it('refuses a channel the organisation does not have', async () => {
    await expect(
      controller.getIntegrationUrl('linkedin', 'someone-else', org)
    ).rejects.toBeInstanceOf(HttpException);
    expect(store.size).toBe(0);
  });
});
