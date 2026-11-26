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

// Two LinkedIn Pages connected through one member share that member's token:
// both rows have the member as their root, and a new token goes to every row
// of the root. Reconnecting one of the pages through ANOTHER member wrote that
// member's token onto the second page too, which the new member may not
// administer: the second page then failed to post (upstream 356045009).
describe('reconnecting a page through another login', () => {
  const build = (storedRoot = 'member-1') => {
    const findUnique = jest.fn().mockResolvedValue({ rootInternalId: storedRoot });
    const findFirst = jest.fn().mockResolvedValue({ rootInternalId: storedRoot });
    const upsert = jest.fn().mockResolvedValue({ id: 'page-a-row' });
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const repository = new IntegrationRepository(
      { model: { integration: { findUnique, findFirst, upsert, updateMany } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const connect = (refreshToken: string, reconnectedBy?: string) =>
      repository.createOrUpdateIntegration(
        undefined,
        true,
        'org-1',
        'Page A',
        undefined,
        'social',
        'page-a',
        'linkedin-page',
        'access-new',
        refreshToken,
        3600,
        'page-a',
        false,
        'page-a',
        undefined,
        undefined,
        undefined,
        reconnectedBy
      );
    return { connect, upsert, updateMany };
  };

  it('shares the new token only with the pages of the login that reconnected', async () => {
    const { connect, updateMany } = build();
    await connect('refresh-new', 'member-2');
    expect(updateMany.mock.calls[0][0].where).toMatchObject({
      rootInternalId: 'member-2',
      organizationId: 'org-1',
    });
  });

  it('moves the reconnected page under that login', async () => {
    const { connect, upsert } = build();
    await connect('refresh-new', 'member-2');
    expect(upsert.mock.calls[0][0].update.rootInternalId).toBe('member-2');
  });

  it('drops the previous login refresh token when the new login sent none', async () => {
    const { connect, upsert } = build();
    await connect('', 'member-2');
    expect(upsert.mock.calls[0][0].update).toHaveProperty('refreshToken');
  });

  it('keeps the stored refresh token when the same login reconnects without one', async () => {
    const { connect, upsert } = build();
    await connect('', 'member-1');
    expect(upsert.mock.calls[0][0].update).not.toHaveProperty('refreshToken');
  });

  it('a token refresh (no login named) still reaches every page of the stored root', async () => {
    const { connect, upsert, updateMany } = build();
    await connect('refresh-new');
    expect(updateMany.mock.calls[0][0].where.rootInternalId).toBe('member-1');
    expect(upsert.mock.calls[0][0].update).not.toHaveProperty('rootInternalId');
  });
});
