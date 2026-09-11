// nostr-tools is ESM and stops jest dead; it arrives through the integration
// manager, which this test only ever passes in as a stub anyway.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

// E2E-09-43: the failure branch inside the loop was a `return`, not a
// `continue`, so one expired channel anywhere in the list silently skipped the
// refresh of every channel after it — and the command printed nothing on
// success, so the operator assumed they had all been refreshed. This is the
// manual rescue path for expired tokens, so it failed at exactly the moment it
// was needed.

const channel = (id: string, provider = 'instagram') => ({
  id,
  name: `channel ${id}`,
  providerIdentifier: provider,
  organizationId: 'org-1',
  refreshToken: `refresh-${id}`,
});

const build = (channels: any[], failing: string[]) => {
  const repository = {
    needsToBeRefreshed: jest.fn().mockResolvedValue(channels),
    refreshNeeded: jest.fn().mockResolvedValue(undefined),
  };
  const manager = {
    getSocialIntegration: jest.fn().mockReturnValue({ oneTimeToken: false }),
  };
  const service = new IntegrationService(
    repository as any,
    {} as any, // autoposts
    manager as any,
    {} as any, // notifications
    {} as any, // refresh integrations
    {} as any, // temporal
    {} as any // audit
  );

  jest
    .spyOn(service, 'refreshToken')
    .mockImplementation(async (_provider: any, refresh: string) =>
      failing.some((f) => refresh === `refresh-${f}`)
        ? (false as any)
        : { refreshToken: 'r', accessToken: 'a', expiresIn: 3600 }
    );
  jest
    .spyOn(service, 'createOrUpdateIntegration')
    .mockResolvedValue(undefined as any);
  jest
    .spyOn(service as any, 'informAboutRefreshError')
    .mockResolvedValue(undefined);

  return { service, repository };
};

describe('refreshTokens', () => {
  it('keeps going past a channel it could not refresh', async () => {
    const { service } = build(
      [channel('a'), channel('b'), channel('c')],
      ['a']
    );

    const report = await service.refreshTokens(true);

    expect(report.total).toBe(3);
    expect(report.failed.map((c) => c.id)).toEqual(['a']);
    expect(report.refreshed.map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('still flags the channel that failed', async () => {
    const { service, repository } = build([channel('a'), channel('b')], ['a']);
    await service.refreshTokens(true);

    expect(repository.refreshNeeded).toHaveBeenCalledTimes(1);
    expect(repository.refreshNeeded).toHaveBeenCalledWith('org-1', 'a');
  });

  it('reports every failure, not only the first', async () => {
    const { service } = build(
      [channel('a'), channel('b'), channel('c')],
      ['a', 'c']
    );

    const report = await service.refreshTokens(true);
    expect(report.failed.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('calls no provider and writes nothing on a dry run', async () => {
    const { service, repository } = build([channel('a'), channel('b')], ['a']);

    const report = await service.refreshTokens(false);

    expect(service.refreshToken).not.toHaveBeenCalled();
    expect(service.createOrUpdateIntegration).not.toHaveBeenCalled();
    expect(repository.refreshNeeded).not.toHaveBeenCalled();
    expect(report.total).toBe(2);
  });

  it('says nothing was due when nothing was', async () => {
    const { service } = build([], []);
    const report = await service.refreshTokens(true);
    expect(report).toEqual({ total: 0, refreshed: [], failed: [] });
  });
});
