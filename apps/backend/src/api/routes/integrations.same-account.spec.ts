// The controllers pull in IntegrationManager, which reaches every provider —
// including nostr-tools, whose ESM build jest does not parse.
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

const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => {
      store.delete(k);
      return 1;
    }),
  },
}));

import { HttpException } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

/**
 * Instagram connects two ways, through a Facebook Page (`instagram`) and with
 * Instagram login (`instagram-standalone`), and both report the same
 * Instagram account id. A channel is unique per provider, so the same account
 * became two channels: every post went out twice and the account took two of
 * the plan's channels (measured on production 2026-10-27: one account in one
 * organisation connected both ways).
 */

const ORG = { id: 'org-1', isTrailing: false } as any;
const IG_ACCOUNT = '17841400000000000';

// The real lookup over a stubbed channel list, so the test covers which
// providers count as the same account, not a mock of the answer.
const integrationService = (channels: any[]) => {
  const real = new IntegrationService(
    { getIntegrationsList: jest.fn(async () => channels) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return {
    hasChannel: jest.fn(async (_org: string, provider: string, id: string) =>
      channels.some(
        (c) => c.providerIdentifier === provider && c.internalId === id
      )
    ),
    getIntegrationsList: jest.fn(async () => channels),
    connectedThroughOtherRoute: real.connectedThroughOtherRoute.bind(real),
    checkPreviousConnections: jest.fn(async () => false),
    createOrUpdateIntegration: jest.fn(async () => ({ id: 'int-new' })),
  };
};

const standalone = {
  authenticate: jest.fn(async () => ({
    id: IG_ACCOUNT,
    accessToken: 'at',
    refreshToken: 'at',
    expiresIn: 3600,
    name: 'Shop',
    picture: '',
    username: 'shop',
  })),
};

const manager = {
  getAllowedSocialsIntegrations: () => ['instagram-standalone'],
  getSocialIntegration: () => standalone,
  isOffered: () => true,
};

describe('POST /integrations/social-connect/instagram-standalone', () => {
  beforeAll(() => (process.env.JWT_SECRET = 'test-secret'));

  const connect = async (channels: any[], refresh?: string) => {
    store.clear();
    store.set('login:st-1', 'cv');
    store.set('organization:st-1', 'org-1');
    if (refresh) store.set('refresh:st-1', refresh);
    const integrations = integrationService(channels);
    const controller = new NoAuthIntegrationsController(
      manager as any,
      integrations as any,
      { startRefreshWorkflow: jest.fn(async () => undefined) } as any,
      {
        getUserOrgMembership: jest.fn(async () => ({ role: 'ADMIN' })),
        getSessionMembership: jest.fn(async () => ({ role: 'ADMIN' })),
        getOrgById: jest.fn(async () => ORG),
      } as any,
      { getSubscriptionByOrganizationId: jest.fn(async () => null) } as any
    );
    const req = {
      headers: { auth: AuthService.signJWT({ id: 'user-1' }) },
      cookies: {},
    } as any;
    const outcome = await controller
      .connectSocialMedia(
        'instagram-standalone',
        { state: 'st-1', code: 'c', timezone: '0' } as any,
        req
      )
      .then(
        () => 'created',
        (e) =>
          e instanceof HttpException
            ? `${e.getStatus()} ${e.message}`
            : String(e)
      );
    return { outcome, integrations };
  };

  it('⛔ refuses an account the org already has through a Facebook Page', async () => {
    const { outcome, integrations } = await connect([
      { providerIdentifier: 'instagram', internalId: IG_ACCOUNT },
    ]);
    expect(outcome).toBe(
      '409 This Instagram account is already connected in Postra through a Facebook Page. Keep using that channel, or remove it first to connect the account without a Facebook Page.'
    );
    expect(integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('connects an account the org does not have yet', async () => {
    const { integrations } = await connect([
      { providerIdentifier: 'instagram', internalId: '17841499999999999' },
    ]);
    expect(integrations.createOrUpdateIntegration).toHaveBeenCalled();
  });

  it('reconnecting the channel it already is still works', async () => {
    const { integrations } = await connect(
      [
        { providerIdentifier: 'instagram-standalone', internalId: IG_ACCOUNT },
        { providerIdentifier: 'instagram', internalId: IG_ACCOUNT },
      ],
      IG_ACCOUNT
    );
    expect(integrations.createOrUpdateIntegration).toHaveBeenCalled();
  });
});
