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
  const build = (freshScopes: string | null = null) => {
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
        grantedScopes: freshScopes,
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

  // 2026-11-19: reconnecting YouTube with the comment scope granted it on the
  // fresh row, and the surviving row kept the old (empty) list, so the
  // channel still had no first comment. Same for a Facebook or Instagram
  // Page re-added to get pages_manage_engagement: Help tells the customer
  // to reconnect once, and the button never came back.
  it('moves the scopes granted to the fresh login onto the surviving row', async () => {
    const scopes = JSON.stringify([
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ]);
    const { repository, update } = build(scopes);

    await repository.updateIntegration('int-new', {
      organizationId: 'org-1',
      internalId: 'page-1',
      name: 'Brand channel',
      token: 'access-new',
    } as any);

    const survivor = update.mock.calls.find(
      ([call]) => call.where.id === 'int-old'
    )![0];
    expect(survivor.data.grantedScopes).toBe(scopes);
  });

  it('keeps the surviving row\'s scopes when the fresh login recorded none', async () => {
    const { repository, update } = build(null);

    await repository.updateIntegration('int-new', {
      organizationId: 'org-1',
      internalId: 'page-1',
      name: 'Brand channel',
      token: 'access-new',
    } as any);

    const survivor = update.mock.calls.find(
      ([call]) => call.where.id === 'int-old'
    )![0];
    expect(survivor.data).not.toHaveProperty('grantedScopes');
  });
});
