import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { ThirdPartyRepository } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.repository';

// E2E-11-68: another organisation's (or an unknown) id in an org-scoped
// update threw Prisma P2025, a 500 and a Sentry event. Nothing was written;
// it is a 404, as everywhere else.
const missing = () =>
  Promise.reject(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }));

describe('org-scoped updates of an id that is not the organisation’s', () => {
  it('channel settings answer 404', async () => {
    const repository = new IntegrationRepository(
      { model: { integration: { update: missing } } } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any
    );
    await expect(repository.updateProviderSettings('org-b', 'ch-a', '[]')).rejects.toMatchObject({ status: 404 });
  });

  it('deleting a third-party integration answers 404', async () => {
    const repository = new ThirdPartyRepository({ model: { thirdParty: { update: missing } } } as any);
    await expect(repository.deleteIntegration('org-b', 'tp-a')).rejects.toMatchObject({ status: 404 });
  });

  it('any other database error still fails as it is', async () => {
    const repository = new ThirdPartyRepository({
      model: { thirdParty: { update: () => Promise.reject(new Error('connection lost')) } },
    } as any);
    await expect(repository.deleteIntegration('org-b', 'tp-a')).rejects.toThrow('connection lost');
  });
});
