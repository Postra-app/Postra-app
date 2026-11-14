jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
}));

import { HttpException } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { NO_PAGE_PERMISSION } from '@gitroom/nestjs-libraries/integrations/social/page.permission';

// Choosing a page the login cannot manage threw a plain Error: the route
// answered 500 and the window showed "Internal server error" instead of what
// to do about it.
describe('choosing a page the login cannot manage', () => {
  const save = (error: Error) => {
    const repository = {
      getIntegrationById: jest.fn(async () => ({ id: 'pending-1', inBetweenSteps: true, providerIdentifier: 'instagram', token: 'user-token' })),
      updateIntegration: jest.fn(),
    };
    const provider = { fetchPageInformation: jest.fn().mockRejectedValue(error) };
    const service = new IntegrationService(repository as any, {} as any, { getSocialIntegration: () => provider } as any, {} as any, {} as any, {} as any, {} as any);
    return service.saveProviderPage('org-1', 'pending-1', { pageId: '1', id: '2' }).then(
      () => 'saved',
      (e) => (e instanceof HttpException ? `${e.getStatus()} ${e.message}` : `${e.constructor.name}: ${e.message}`)
    );
  };

  it('is a 400 with the reason', async () => {
    expect(await save(new Error(NO_PAGE_PERMISSION))).toBe(`400 ${NO_PAGE_PERMISSION}`);
  });

  it('any other failure stays an error, its text not shown', async () => {
    expect(await save(new TypeError('fetch failed'))).toBe('TypeError: fetch failed');
  });
});
