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

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { AutopostController } from './autopost.controller';
import { ThirdPartyController } from './third-party.controller';
import { IntegrationsController } from './integrations.controller';

/**
 * A member (role USER) created AutoPost
 * feeds, saved third-party API keys, connected new channels and minted
 * channel invite links, while sibling routes (webhooks, channel delete,
 * channel group) were already for admins. Feeds, keys, new channels and
 * invite links are now for admins; Brand Kit, channel settings and
 * re-authenticating an existing channel stay open to members.
 */

const ADMIN_POLICY = [AuthorizationActions.Create, Sections.ADMIN];

const routes = (controller: any) => {
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined)
    .map((name) => ({
      name,
      method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name])],
      path: Reflect.getMetadata(PATH_METADATA, proto[name]),
      policies: (Reflect.getMetadata(CHECK_POLICIES_KEY, proto[name]) ||
        []) as any[],
    }));
};

const adminOnly = (r: { policies: any[] }) =>
  r.policies.some(
    (p) => p[0] === ADMIN_POLICY[0] && p[1] === ADMIN_POLICY[1]
  );

const route = (controller: any, method: string, path: string) => {
  const found = routes(controller).find(
    (r) => r.method === method && r.path === path
  );
  if (!found) {
    throw new Error(`no route ${method} ${path}`);
  }
  return found;
};

describe('admin-only routes for a member', () => {
  it.each([
    ['POST', '/'],
    ['PUT', '/:id'],
    ['DELETE', '/:id'],
    ['POST', '/:id/active'],
    ['POST', '/send'],
  ])('AutoPost %s %s is for admins', (method, path) => {
    expect(adminOnly(route(AutopostController, method, path))).toBe(true);
  });

  it('a member still lists the feeds', () => {
    expect(adminOnly(route(AutopostController, 'GET', '/'))).toBe(false);
  });

  it('the admin check comes first, so a member gets 403, not a billing 402', () => {
    const create = route(AutopostController, 'POST', '/');
    expect(create.policies[0]).toEqual(ADMIN_POLICY);
  });

  it.each([
    ['POST', '/:identifier'],
    ['DELETE', '/:id'],
  ])('third-party keys %s %s are for admins', (method, path) => {
    expect(adminOnly(route(ThirdPartyController, method, path))).toBe(true);
  });

  it.each([
    ['POST', '/:id/submit'],
    ['POST', '/function/:id/:functionName'],
    ['POST', '/:id/import'],
    ['GET', '/'],
  ])('a member keeps using saved third-party keys: %s %s', (method, path) => {
    expect(adminOnly(route(ThirdPartyController, method, path))).toBe(false);
  });

  it.each([
    ['POST', '/:id/settings'],
    ['POST', '/:id/nickname'],
  ])('a member keeps channel settings: %s %s', (method, path) => {
    expect(adminOnly(route(IntegrationsController, method, path))).toBe(false);
  });
});

describe('GET /integrations/social/:integration by role', () => {
  const env = process.env.STRIPE_PUBLISHABLE_KEY;
  beforeAll(() => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.FRONTEND_URL = 'https://app.example';
  });
  afterAll(() => (process.env.STRIPE_PUBLISHABLE_KEY = env));
  beforeEach(() => store.clear());

  const CHANNEL = 'guild-1';
  const provider = {
    generateAuthUrl: jest.fn(async () => ({
      url: 'https://discord.com/oauth2/authorize?state=st-1',
      state: 'st-1',
      codeVerifier: 'cv',
    })),
  };
  const manager = {
    getAllowedSocialsIntegrations: () => ['discord'],
    getSocialIntegration: () => provider,
    isPreview: () => false,
    isOffered: () => true,
  };
  const integrations = {
    hasChannel: jest.fn(
      async (_org: string, platform: string, id: string) =>
        platform === 'discord' && id === CHANNEL
    ),
  };

  const call = (role: string, refresh = '', invite = '') =>
    new IntegrationsController(
      manager as any,
      integrations as any,
      {} as any,
      {} as any
    )
      .getIntegrationUrl(
        'discord',
        refresh,
        '',
        '',
        '',
        invite,
        { id: 'org-1', users: [{ role }] } as any,
        { isSuperAdmin: false } as any
      )
      .then(
        (res: any) => res,
        (err: any) => ({ status: err?.getStatus?.() })
      );

  it('⛔ a member cannot start connecting a new channel', async () => {
    expect(await call('USER')).toEqual({ status: 403 });
    expect(store.size).toBe(0);
  });

  it('⛔ a member cannot mint a channel invite link', async () => {
    expect(await call('USER', '', 'true')).toEqual({ status: 403 });
    expect(await call('USER', CHANNEL, 'true')).toEqual({ status: 403 });
    expect([...store.keys()].some((k) => k.startsWith('invite:'))).toBe(false);
  });

  it('a member can re-authenticate a channel the organisation has', async () => {
    const res = await call('USER', CHANNEL);
    expect(res.url).toContain('discord.com');
  });

  it.each(['ADMIN', 'SUPERADMIN'])('%s connects and invites', async (role) => {
    expect((await call(role)).url).toContain('discord.com');
    expect((await call(role, '', 'true')).url).toMatch(
      /^https:\/\/app\.example\/connect\/discord\/[0-9a-f]{64}$/
    );
  });
});
