jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// GET /public/v1/analytics/:integration passes `date` through as given. Left
// out, the provider was asked for NaN days and every channel came back empty
// (measured on production: Threads 0 series without it, 5 with date=7).

const build = () => {
  const analytics = jest.fn().mockResolvedValue([{ label: 'Views', data: [] }]);
  const service = new IntegrationService(
    {} as any,
    {} as any,
    { getSocialIntegration: () => ({ analytics }) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  jest.spyOn(service, 'getIntegrationById').mockResolvedValue({
    id: 'ch-1',
    internalId: 'internal-1',
    token: 'token',
    type: 'social',
    providerIdentifier: 'threads',
    tokenExpiration: new Date(Date.now() + 86_400_000),
  } as any);
  return { service, analytics };
};

describe('checkAnalytics: days to load', () => {
  afterEach(() => jest.clearAllMocks());

  it.each([[undefined], [''], ['abc'], ['-3']])(
    'falls back to 7 days for date=%p',
    async (date) => {
      const { service, analytics } = build();
      await service.checkAnalytics({ id: 'org-1' } as any, 'ch-1', date as any);
      expect(analytics).toHaveBeenCalledWith('internal-1', 'token', 7);
      expect((ioRedis.set as jest.Mock).mock.calls[0][0]).toBe('integration:org-1:ch-1:7');
    }
  );

  it('keeps the days asked for', async () => {
    const { service, analytics } = build();
    await service.checkAnalytics({ id: 'org-1' } as any, 'ch-1', '30');
    expect(analytics).toHaveBeenCalledWith('internal-1', 'token', 30);
  });
});
