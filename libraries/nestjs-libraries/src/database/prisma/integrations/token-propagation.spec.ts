jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));


import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// INT-9: a shared LinkedIn token refreshed in one organisation was written
// into every channel with the same root account, other organisations included.
it('a shared token is passed on only within the same organisation', async () => {
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const integration = {
    upsert: jest.fn().mockResolvedValue({ id: 'int-b', providerIdentifier: 'linkedin-page' }),
    findFirst: jest.fn().mockResolvedValue({ rootInternalId: 'user-u' }),
    updateMany,
  };
  const repository = new IntegrationRepository({ model: { integration } } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  await repository.createOrUpdateIntegration(undefined, true, 'org-b', 'Page P2', undefined, 'social', 'page-p2', 'linkedin-page', 'token', 'refresh', 3600);
  expect(updateMany.mock.calls[0][0].where).toMatchObject({ rootInternalId: 'user-u', organizationId: 'org-b', deletedAt: null });
});

// INT-14: a plug switched off (or its channel disabled) after the post went
// out still ran its comment or repost.
describe('a scheduled plug', () => {
  const run = async (plug: Record<string, unknown>) => {
    const provider = { autoRepostPost: jest.fn().mockResolvedValue(true) };
    const service = Object.create(IntegrationService.prototype) as any;
    service._integrationRepository = {
      getPlug: jest.fn().mockResolvedValue({
        plugFunction: 'autoRepostPost',
        data: '[]',
        activated: true,
        integration: { providerIdentifier: 'x', disabled: false, deletedAt: null },
        ...plug,
      }),
    };
    service._integrationManager = { getSocialIntegration: () => provider };
    const done = await service.processPlugs({ plugId: 'p', postId: 'post', delay: 0, totalRuns: 3, currentRun: 1 });
    return { done, provider };
  };

  it('switched off: does not run, and ends', async () => {
    const { done, provider } = await run({ activated: false });
    expect(done).toBe(true);
    expect(provider.autoRepostPost).not.toHaveBeenCalled();
  });

  it('on a disabled channel: does not run', async () => {
    const { provider } = await run({ integration: { providerIdentifier: 'x', disabled: true, deletedAt: null } });
    expect(provider.autoRepostPost).not.toHaveBeenCalled();
  });

  it('switched on: runs', async () => {
    const { provider } = await run({});
    expect(provider.autoRepostPost).toHaveBeenCalledTimes(1);
  });
});
