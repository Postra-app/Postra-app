jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {},
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { decryptIntegrationToken: (t: string) => t },
}));

import { RefreshIntegrationService } from './refresh.integration.service';

/**
 * INT-13 — any failed refresh marked the channel "reconnect needed" and
 * disconnected it, a 503 or a dropped connection included. A brief outage at
 * the provider cost the customer a manual reconnect.
 */
const integration = {
  id: 'i1',
  organizationId: 'org-1',
  providerIdentifier: 'linkedin',
  refreshToken: 'r',
  internalId: 'x',
  rootInternalId: 'x',
} as any;

const setup = (failure: unknown) => {
  const integrations = {
    refreshNeeded: jest.fn(),
    informAboutRefreshError: jest.fn(),
    disconnectChannel: jest.fn(),
    createOrUpdateIntegration: jest.fn(),
  };
  const provider = { refreshToken: jest.fn().mockRejectedValue(failure) };
  const service = new RefreshIntegrationService(
    { getSocialIntegration: () => provider } as any,
    integrations as any,
    {} as any
  );
  return { service, integrations };
};

const outages: [string, unknown][] = [
  ['dropped connection', Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })],
  ['timeout', Object.assign(new Error('aborted'), { name: 'TimeoutError' })],
  ['503 from the provider', Object.assign(new Error('Service Unavailable'), { status: 503 })],
  ['429 from the provider', Object.assign(new Error('Too Many Requests'), { statusCode: 429 })],
];

it.each(outages)('%s: this attempt fails, the channel stays connected', async (_n, err) => {
  const { service, integrations } = setup(err);
  expect(await service.refresh(integration)).toBe(false);
  expect(integrations.refreshNeeded).not.toHaveBeenCalled();
  expect(integrations.disconnectChannel).not.toHaveBeenCalled();
});

it('a refused grant still asks for a reconnect', async () => {
  const { service, integrations } = setup(
    Object.assign(new Error('invalid_grant'), { status: 400 })
  );
  expect(await service.refresh(integration)).toBe(false);
  expect(integrations.refreshNeeded).toHaveBeenCalledWith('org-1', 'i1');
  expect(integrations.disconnectChannel).toHaveBeenCalled();
});

// INT-7: a channel removed while its token was being refreshed came back to
// life when the new tokens were written through the upsert.
it('a channel removed during the refresh is not written back', async () => {
  const integrations = {
    refreshNeeded: jest.fn(),
    informAboutRefreshError: jest.fn(),
    disconnectChannel: jest.fn(),
    createOrUpdateIntegration: jest.fn(),
    getIntegrationById: jest.fn().mockResolvedValue(null),
  };
  const provider = { refreshToken: jest.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'r2', expiresIn: 3600 }) };
  const service = new RefreshIntegrationService(
    { getSocialIntegration: () => provider } as any,
    integrations as any,
    {} as any
  );
  expect(await service.refresh(integration)).toBe(false);
  expect(integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
});
