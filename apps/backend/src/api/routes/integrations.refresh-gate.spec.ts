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
import { IntegrationsController } from './integrations.controller';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

/**
 * ⛔ E2E-01-19 — `refresh` let a FREE org connect a platform outside its plan.
 *
 * A reconnect skips the plan and channel-limit gates, so an existing channel
 * can always be re-authenticated. But `refresh` was whatever the caller put in
 * the query string, and the callback only checked that it equalled the
 * provider account id — which the person connecting always knows, because it
 * is their own. FREE does not include Discord, yet `?refresh=<own guild id>`
 * went through both gates and created the channel.
 */

const FREE_ORG = { id: 'org-1', isTrailing: false } as any;
const GUILD = 'guild-123';

const integrationService = (channels: any[]) => ({
  hasChannel: jest.fn(async (_org: string, provider: string, id: string) =>
    channels.some(
      (c) => c.providerIdentifier === provider && c.internalId === id
    )
  ),
  getIntegrationsList: jest.fn(async () => channels),
  checkPreviousConnections: jest.fn(async () => false),
  createOrUpdateIntegration: jest.fn(async () => ({ id: 'int-new' })),
});

const provider = {
  generateAuthUrl: jest.fn(async () => ({
    url: 'https://discord.com/oauth2/authorize?state=st-1',
    state: 'st-1',
    codeVerifier: 'cv',
  })),
  authenticate: jest.fn(async () => ({
    id: GUILD,
    accessToken: 'at',
    refreshToken: 'rt',
    expiresIn: 3600,
    name: 'My guild',
    picture: '',
    username: 'guild',
  })),
};

const manager = {
  getAllowedSocialsIntegrations: () => ['discord'],
  getSocialIntegration: () => provider,
};

describe('GET /integrations/social/:integration?refresh=', () => {
  const env = process.env.STRIPE_PUBLISHABLE_KEY;
  beforeAll(() => (process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x'));
  afterAll(() => (process.env.STRIPE_PUBLISHABLE_KEY = env));

  const url = (channels: any[], refresh?: string) =>
    new IntegrationsController(
      manager as any,
      integrationService(channels) as any,
      {} as any,
      {} as any
    ).getIntegrationUrl('discord', refresh as any, '', '', '', '', FREE_ORG);

  it('a platform outside the plan is refused, as before', async () => {
    await expect(url([])).rejects.toMatchObject({ status: 402 });
  });

  it('⛔ refresh naming a channel the org does not have is refused', async () => {
    await expect(url([], GUILD)).rejects.toMatchObject({ status: 404 });
  });

  it('refresh of a channel the org has still reconnects above the plan', async () => {
    const res: any = await url(
      [{ providerIdentifier: 'discord', internalId: GUILD }],
      GUILD
    );
    expect(res.url).toContain('discord.com');
  });
});

describe('POST /integrations/social-connect/:integration with refresh', () => {
  const env = process.env.STRIPE_PUBLISHABLE_KEY;
  beforeAll(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    process.env.JWT_SECRET = 'test-secret';
  });
  afterAll(() => (process.env.STRIPE_PUBLISHABLE_KEY = env));

  const connect = async (channels: any[]) => {
    store.clear();
    store.set('login:st-1', 'cv');
    store.set('organization:st-1', 'org-1');
    // The state was minted by a request that forged `refresh` directly.
    store.set('refresh:st-1', GUILD);
    const integrations = integrationService(channels);
    const controller = new NoAuthIntegrationsController(
      manager as any,
      integrations as any,
      {} as any,
      {
        getUserOrgMembership: jest.fn(async () => ({ role: 'ADMIN' })),
        getOrgById: jest.fn(async () => FREE_ORG),
      } as any,
      { getSubscriptionByOrganizationId: jest.fn(async () => null) } as any
    );
    const req = {
      headers: { auth: AuthService.signJWT({ id: 'user-1' }) },
      cookies: {},
    } as any;
    const outcome = await controller
      .connectSocialMedia(
        'discord',
        { state: 'st-1', code: 'c', timezone: '0' } as any,
        req
      )
      .then(
        () => 'created',
        (e) => (e instanceof HttpException ? e.getStatus() : String(e))
      );
    return { outcome, integrations };
  };

  it('⛔ does not create a channel the plan does not allow', async () => {
    const { outcome, integrations } = await connect([]);
    expect(outcome).toBe(404);
    expect(integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('reconnects a channel the org already has', async () => {
    const { integrations } = await connect([
      { providerIdentifier: 'discord', internalId: GUILD },
    ]);
    expect(integrations.createOrUpdateIntegration).toHaveBeenCalled();
  });
});
