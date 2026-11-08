jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// A Facebook Page (or an Instagram account through one) is only known when it
// is picked, after the callback checked the person's own id. A page live in
// another organisation was connected a second time there.

const PAGE = '1029384756';

const build = (elsewhere: { id: string; organizationId: string } | null) => {
  const repository = {
    getIntegrationsList: jest.fn(async () => []),
    getIntegrationById: jest.fn(async () => ({
      id: 'pending-1',
      inBetweenSteps: true,
      providerIdentifier: 'facebook',
      token: 'user-token',
    })),
    updateIntegration: jest.fn(async () => ({})),
    findActiveByProviderIdentifier: jest.fn(async () => elsewhere),
  };
  const provider = {
    fetchPageInformation: jest.fn(async () => ({
      id: PAGE,
      name: 'Cafe',
      picture: '',
      access_token: 'page-token',
      username: 'cafe',
    })),
  };
  const service = new IntegrationService(
    repository as any,
    {} as any,
    { getSocialIntegration: () => provider } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  jest
    .spyOn(service as any, 'checkForDeletedOnceAndUpdate')
    .mockResolvedValue(undefined);
  return { service, repository };
};

describe('saveProviderPage: a page belongs to one organisation', () => {
  it('⛔ refuses a page live in another organisation, and saves nothing', async () => {
    const { service, repository } = build({ id: 'chan-9', organizationId: 'org-2' });
    await expect(
      service.saveProviderPage('org-1', 'pending-1', { id: PAGE })
    ).rejects.toMatchObject({
      status: 409,
      message:
        'This channel is already connected to another Postra account. Disconnect it there first, then try again.',
    });
    expect(repository.findActiveByProviderIdentifier).toHaveBeenCalledWith('facebook', PAGE);
    expect(repository.updateIntegration).not.toHaveBeenCalled();
  });

  it('saves a page that is nowhere else, or already in this organisation', async () => {
    for (const elsewhere of [null, { id: 'chan-1', organizationId: 'org-1' }]) {
      const { service, repository } = build(elsewhere);
      await expect(
        service.saveProviderPage('org-1', 'pending-1', { id: PAGE })
      ).resolves.toEqual({ success: true });
      expect(repository.updateIntegration).toHaveBeenCalled();
    }
  });
});
