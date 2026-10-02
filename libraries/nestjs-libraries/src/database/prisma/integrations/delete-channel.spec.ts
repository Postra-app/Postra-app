import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

// Disconnecting a channel only soft-deletes the row, so its encrypted tokens
// used to stay in the database for good. Reconnecting creates a new row and
// nothing reads a deleted channel's tokens, so they are wiped on delete.
describe('IntegrationRepository.deleteChannel', () => {
  it('soft-deletes the channel and drops its tokens', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = new IntegrationRepository(
      { model: { integration: { updateMany } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await repository.deleteChannel('org-1', 'int-1');

    expect(updateMany).toHaveBeenCalledWith({
      // updateMany: a channel outside the org matches nothing instead of
      // throwing, and the service answers 404.
      where: { id: 'int-1', organizationId: 'org-1', deletedAt: null },
      data: {
        deletedAt: expect.any(Date),
        token: '',
        refreshToken: null,
        tokenExpiration: null,
      },
    });
  });
});
