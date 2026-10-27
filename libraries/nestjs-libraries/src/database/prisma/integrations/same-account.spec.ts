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
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// Instagram through a Facebook Page learns the Instagram account id only when
// the account is picked (saveProviderPage), so the same-account check has to
// run there too, not only at the OAuth callback (same.account.ts).

const IG_ACCOUNT = '17841400000000000';

const build = (channels: any[]) => {
  const repository = {
    getIntegrationsList: jest.fn(async () => channels),
    getIntegrationById: jest.fn(async () => ({
      id: 'pending-1',
      inBetweenSteps: true,
      providerIdentifier: 'instagram',
      token: 'user-token',
    })),
    updateIntegration: jest.fn(async () => ({})),
  };
  const provider = {
    fetchPageInformation: jest.fn(async () => ({
      id: IG_ACCOUNT,
      name: 'Shop',
      picture: '',
      access_token: 'page-token',
      username: 'shop',
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

describe('saveProviderPage: one Instagram account, one channel', () => {
  it('⛔ refuses the account the org already has without a Facebook Page', async () => {
    const { service, repository } = build([
      { providerIdentifier: 'instagram-standalone', internalId: IG_ACCOUNT },
    ]);
    await expect(
      service.saveProviderPage('org-1', 'pending-1', { id: 'page-1' })
    ).rejects.toMatchObject({
      status: 409,
      message:
        'This Instagram account is already connected in Postra without a Facebook Page. Keep using that channel, or remove it first to connect the account through your Facebook Page.',
    });
    expect(repository.updateIntegration).not.toHaveBeenCalled();
  });

  it('saves the account when the org does not have it', async () => {
    const { service, repository } = build([
      { providerIdentifier: 'instagram-standalone', internalId: '1784149' },
      { providerIdentifier: 'facebook', internalId: IG_ACCOUNT },
    ]);
    await expect(
      service.saveProviderPage('org-1', 'pending-1', { id: 'page-1' })
    ).resolves.toEqual({ success: true });
    expect(repository.updateIntegration).toHaveBeenCalled();
  });
});

describe('one connection of an Instagram account at a time (Codex 27 X)', () => {
  // The Page pick and the callback without a Page, for the same account at
  // once: both checks ran before either write and the org got two channels.
  const key = `same-account:org-1:instagram:${IG_ACCOUNT}`;

  it('⛔ refuses while the same account is being connected the other way', async () => {
    (ioRedis.set as jest.Mock).mockResolvedValueOnce(null);
    const { service, repository } = build([]);
    await expect(
      service.saveProviderPage('org-1', 'pending-1', { id: 'page-1' })
    ).rejects.toMatchObject({ status: 409 });
    expect(ioRedis.set).toHaveBeenCalledWith(key, '1', 'EX', 30, 'NX');
    expect(repository.updateIntegration).not.toHaveBeenCalled();
  });

  it('holds the account from the check to the write, then lets it go', async () => {
    const { service, repository } = build([]);
    (ioRedis.del as jest.Mock).mockClear();
    await service.saveProviderPage('org-1', 'pending-1', { id: 'page-1' });
    expect(repository.updateIntegration).toHaveBeenCalled();
    expect(ioRedis.del).toHaveBeenCalledWith(key);
  });

  it('lets it go when the save is refused', async () => {
    const { service } = build([
      { providerIdentifier: 'instagram-standalone', internalId: IG_ACCOUNT },
    ]);
    (ioRedis.del as jest.Mock).mockClear();
    await expect(
      service.saveProviderPage('org-1', 'pending-1', { id: 'page-1' })
    ).rejects.toMatchObject({ status: 409 });
    expect(ioRedis.del).toHaveBeenCalledWith(key);
  });

  it('both logins of one account share the key; other platforms take none', async () => {
    const { service } = build([]);
    (ioRedis.set as jest.Mock).mockClear();
    expect(await service.lockSameAccount('org-1', 'instagram-standalone', IG_ACCOUNT)).toBe(key);
    expect(await service.lockSameAccount('org-1', 'threads', 'x')).toBeNull();
    expect(ioRedis.set).toHaveBeenCalledTimes(1);
  });
});

describe('connectedThroughOtherRoute', () => {
  it('pairs only the two Instagram logins', async () => {
    const { service } = build([
      { providerIdentifier: 'instagram', internalId: 'a' },
      { providerIdentifier: 'threads', internalId: 'b' },
    ]);
    expect(
      await service.connectedThroughOtherRoute('o', 'instagram-standalone', 'a')
    ).toBe('instagram');
    expect(
      await service.connectedThroughOtherRoute('o', 'instagram', 'a')
    ).toBeNull();
    expect(
      await service.connectedThroughOtherRoute('o', 'threads', 'b')
    ).toBeNull();
  });
});
