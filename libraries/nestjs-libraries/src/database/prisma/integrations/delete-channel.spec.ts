import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

// Disconnecting a channel only soft-deletes the row, so its encrypted tokens
// used to stay in the database for good. Reconnecting creates a new row and
// nothing reads a deleted channel's tokens, so they are wiped on delete.
describe('IntegrationRepository.deleteChannel', () => {
  it('soft-deletes the channel and drops its tokens', async () => {
    const update = jest.fn().mockResolvedValue({});
    const repository = new IntegrationRepository(
      { model: { integration: { update } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await repository.deleteChannel('org-1', 'int-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'int-1', organizationId: 'org-1' },
      data: {
        deletedAt: expect.any(Date),
        token: '',
        refreshToken: null,
        tokenExpiration: null,
      },
    });
  });
});
