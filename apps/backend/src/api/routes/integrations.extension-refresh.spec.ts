// The controller pulls in IntegrationManager, which reaches every provider —
// including nostr-tools, whose ESM build jest does not parse. Nothing here
// touches a provider.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(async () => null) },
}));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

/**
 * E2E-11-81 — `POST /integrations/extension-refresh` is public: the browser
 * extension sends the token it was handed when the channel was connected and
 * the platform's cookies. The token named only the channel and organisation,
 * so whoever connected it kept refreshing it for 30 days after leaving the
 * organisation, any JWT with those four fields would do, and a platform
 * switched off in Postra still took refreshes.
 */
const cookies = Buffer.from(JSON.stringify({ session: 'x' })).toString(
  'base64'
);

const setup = (opts: { member?: boolean; allowed?: string[] } = {}) => {
  const createOrUpdateIntegration = jest.fn(async () => ({}));
  const getSessionMembership = jest.fn(async () =>
    opts.member === false ? null : { id: 'uo-1' }
  );
  const controller = new NoAuthIntegrationsController(
    {
      getAllowedSocialsIntegrations: () => opts.allowed ?? ['skool'],
      getSocialIntegration: () => ({
        isChromeExtension: true,
        authenticate: jest.fn(async () => ({
          id: 'acct-1',
          accessToken: 'access',
          expiresIn: 3600,
        })),
      }),
    } as any,
    {
      getIntegrationById: jest.fn(async () => ({
        internalId: 'acct-1',
        name: 'Skool',
        providerIdentifier: 'skool',
      })),
      createOrUpdateIntegration,
      refreshNeeded: jest.fn(),
    } as any,
    {} as any,
    { getSessionMembership } as any,
    {} as any
  );
  return { controller, createOrUpdateIntegration, getSessionMembership };
};

const token = (extra: Record<string, unknown> = {}) =>
  AuthService.signJWT({
    purpose: 'extension',
    integrationId: 'int-1',
    organizationId: 'org-1',
    internalId: 'acct-1',
    provider: 'skool',
    userId: 'u1',
    tokenVersion: 0,
    ...extra,
  });

describe('POST /integrations/extension-refresh (E2E-11-81)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('refreshes the channel for a member of its organisation', async () => {
    const { controller, createOrUpdateIntegration, getSessionMembership } =
      setup();
    await expect(
      controller.extensionRefreshCookies({ jwt: token(), cookies })
    ).resolves.toEqual({ success: true });
    expect(getSessionMembership).toHaveBeenCalledWith('u1', 'org-1', 0);
    expect(createOrUpdateIntegration).toHaveBeenCalled();
  });

  it('refuses whoever connected it once they are no longer a member', async () => {
    const { controller, createOrUpdateIntegration } = setup({ member: false });
    await expect(
      controller.extensionRefreshCookies({ jwt: token(), cookies })
    ).rejects.toMatchObject({ status: 403 });
    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('refuses a token that was not issued for the extension', async () => {
    const { controller, createOrUpdateIntegration } = setup();
    const { purpose: _p, ...rest } = AuthService.verifyJWT(token()) as any;
    const notExtension = AuthService.signJWT({
      integrationId: rest.integrationId,
      organizationId: rest.organizationId,
      internalId: rest.internalId,
      provider: rest.provider,
    });
    await expect(
      controller.extensionRefreshCookies({ jwt: notExtension, cookies })
    ).rejects.toMatchObject({ status: 401 });
    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('refuses a platform that is not switched on', async () => {
    const { controller, createOrUpdateIntegration } = setup({ allowed: [] });
    await expect(
      controller.extensionRefreshCookies({ jwt: token(), cookies })
    ).rejects.toMatchObject({ status: 400 });
    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});
