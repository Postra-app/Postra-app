jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// A token refresh of a channel that had not chosen its page yet (Facebook,
// Instagram, LinkedIn Page, YouTube, Google Business) wrote
// inBetweenSteps = false: the channel left the "choose a page" step and looked
// connected with the account id as its page id (upstream #2072).
it('a token refresh leaves the page-selection state as stored', async () => {
  const integration = {
    upsert: jest.fn().mockResolvedValue({ id: 'int-1', providerIdentifier: 'facebook' }),
  };
  const repository = new IntegrationRepository({ model: { integration } } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const service = new IntegrationService(repository, {} as any, {} as any, {} as any, {} as any, {} as any, { record: jest.fn() } as any);

  await service.saveRefreshedTokens(
    { organizationId: 'org-1', name: 'Account', internalId: 'acc-1', providerIdentifier: 'facebook' },
    false,
    { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 }
  );

  const { update } = integration.upsert.mock.calls[0][0];
  expect(update).not.toHaveProperty('inBetweenSteps');
  expect(update.refreshNeeded).toBe(false);
});
