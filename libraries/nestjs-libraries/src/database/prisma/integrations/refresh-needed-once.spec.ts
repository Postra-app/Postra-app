import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

// Upstream 5a5e50f4e: only the call that flags a channel reports it, so its
// later failed refreshes do not tell the customer again.
describe('IntegrationRepository.refreshNeeded', () => {
  const repository = (count: number) => {
    const updateMany = jest.fn().mockResolvedValue({ count });
    return {
      updateMany,
      repo: new IntegrationRepository(
        { model: { integration: { updateMany } } } as any,
        {} as any, {} as any, {} as any, {} as any, {} as any
      ),
    };
  };

  it('flags a channel of the organisation that is not flagged yet, and says it did', async () => {
    const { repo, updateMany } = repository(1);
    await expect(repo.refreshNeeded('org-1', 'ch-1')).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'ch-1', organizationId: 'org-1', refreshNeeded: false },
      data: { refreshNeeded: true },
    });
  });

  it('says no when the channel was already flagged (or is not the organisation’s)', async () => {
    await expect(repository(0).repo.refreshNeeded('org-1', 'ch-1')).resolves.toBe(false);
  });
});
