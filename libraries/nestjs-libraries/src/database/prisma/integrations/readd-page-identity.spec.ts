jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

// Upstream e3f6c4a3b (2026-10-24): a page picked again through a fresh login
// keeps the old row, and the old row kept the old login's refresh token,
// root identity and expiry. Once the fresh access token expired, every
// refresh ran as the old identity ("Channel not found" every hour for a
// YouTube brand channel first connected from an account that cannot see it).
describe('re-adding a page that is already connected', () => {
  const build = () => {
    const findUnique = jest
      .fn()
      // the fresh row's provider
      .mockResolvedValueOnce({ providerIdentifier: 'youtube' })
      // the live row that already holds this page
      .mockResolvedValueOnce({ id: 'int-old' })
      // the fresh row's identity
      .mockResolvedValueOnce({
        rootInternalId: 'root-new',
        refreshToken: 'enc::refresh-new',
        tokenExpiration: new Date('2026-11-01T00:00:00Z'),
      });
    const update = jest.fn().mockResolvedValue({ id: 'int-old' });
    const integration = { findUnique, update };
    const posts = {
      model: {
        post: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      },
    };
    const repository = new IntegrationRepository(
      { model: { integration } } as any,
      posts as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { repository, update };
  };

  it('moves the fresh login identity and refresh token onto the surviving row', async () => {
    const { repository, update } = build();

    await repository.updateIntegration('int-new', {
      organizationId: 'org-1',
      internalId: 'page-1',
      name: 'Brand channel',
      token: 'access-new',
    } as any);

    const survivor = update.mock.calls.find(
      ([call]) => call.where.id === 'int-old'
    )![0];
    expect(survivor.data).toMatchObject({
      rootInternalId: 'root-new',
      refreshToken: 'enc::refresh-new',
      tokenExpiration: new Date('2026-11-01T00:00:00Z'),
      refreshNeeded: false,
      deletedAt: null,
      disabled: false,
    });
    expect(
      update.mock.calls.find(([call]) => call.where.id === 'int-new')![0].data
        .deletedAt
    ).toBeInstanceOf(Date);
  });
});
