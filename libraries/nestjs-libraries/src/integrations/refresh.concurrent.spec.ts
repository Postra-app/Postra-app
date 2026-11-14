jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {},
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { decryptIntegrationToken: (t: string) => t },
}));
jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

import { RefreshIntegrationService } from './refresh.integration.service';

/**
 * Two flows refresh one TikTok channel at once (two posts at the same minute,
 * a post and analytics). TikTok replaces the refresh token on every refresh:
 * it accepts the first and rejects the second. The second flow flagged the
 * channel and told the customer to reconnect, although the first had just
 * stored valid tokens (upstream 878636e82).
 */
const integration = {
  id: 'i1',
  organizationId: 'org-1',
  providerIdentifier: 'tiktok',
  internalId: 'acc',
  rootInternalId: 'acc',
  name: 'Shop',
  token: 'old-access',
  refreshToken: 'old-refresh',
} as any;

const row = (over: Record<string, unknown> = {}) => ({
  ...integration,
  refreshNeeded: false,
  inBetweenSteps: false,
  deletedAt: null,
  tokenExpiration: new Date(Date.now() + 3_600_000),
  ...over,
});

const setup = (reads: unknown[]) => {
  const getIntegrationById = jest.fn();
  for (const r of reads) getIntegrationById.mockResolvedValueOnce(r);
  getIntegrationById.mockResolvedValue(reads[reads.length - 1]);
  const integrations = {
    getIntegrationById,
    refreshNeeded: jest.fn().mockResolvedValue(true),
    disconnectChannel: jest.fn(),
    saveRefreshedTokens: jest.fn(),
  };
  const provider = {
    refreshToken: jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('invalid_grant'), { status: 400 })),
  };
  const service = new RefreshIntegrationService(
    { getSocialIntegration: () => provider } as any,
    integrations as any,
    {} as any
  );
  return { service, integrations };
};

it('takes the tokens another flow stored instead of flagging the channel', async () => {
  // Not stored yet on the first read; stored on the second.
  const { service, integrations } = setup([
    row(),
    row({ token: 'new-access', refreshToken: 'new-refresh' }),
  ]);
  const result = await service.refresh(integration);
  expect(result).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  expect(integrations.refreshNeeded).not.toHaveBeenCalled();
  expect(integrations.disconnectChannel).not.toHaveBeenCalled();
  // Not written back: a third flow may have renewed them since.
  expect(integrations.saveRefreshedTokens).not.toHaveBeenCalled();
});

it('still flags the channel when nobody renewed it', async () => {
  const { service, integrations } = setup([row()]);
  expect(await service.refresh(integration)).toBe(false);
  expect(integrations.getIntegrationById).toHaveBeenCalledTimes(3);
  expect(integrations.refreshNeeded).toHaveBeenCalledWith('org-1', 'i1');
  expect(integrations.disconnectChannel).toHaveBeenCalled();
});

it('does not reuse expired tokens, a flagged channel or another account', async () => {
  for (const stored of [
    row({ token: 'a2', refreshToken: 'r2', tokenExpiration: new Date(Date.now() - 1000) }),
    row({ token: 'a2', refreshToken: 'r2', refreshNeeded: true }),
    row({ token: 'a2', refreshToken: 'r2', internalId: 'someone-else' }),
    row({ token: 'old-access', refreshToken: 'r2' }),
  ]) {
    const { service, integrations } = setup([stored]);
    expect(await service.refresh(integration)).toBe(false);
    expect(integrations.refreshNeeded).toHaveBeenCalled();
  }
});
