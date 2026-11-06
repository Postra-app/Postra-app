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
    set: jest.fn(async (k: string, v: string, ...rest: unknown[]) => {
      if (rest.includes('NX') && store.has(k)) return null;
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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ConnectIntegrationDto } from '@gitroom/nestjs-libraries/dtos/integrations/connect.integration.dto';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

/**
 * The mobile app can finish a Facebook connection with a token from the
 * Facebook Login SDK instead of an OAuth code. It goes through the same route
 * as the code, so the state minted for the signed-in member's organisation,
 * the plan gates and the channel locks all still apply; only the way the
 * provider gets the user token changes.
 */

const ORG = { id: 'org-1', isTrailing: false } as any;
const FB_USER = '10001';

const details = {
  id: FB_USER,
  accessToken: 'LONG',
  refreshToken: 'LONG',
  expiresIn: 3600,
  name: 'Kris',
  picture: '',
  username: '',
};

const setup = (provider: Record<string, any>, state = true) => {
  store.clear();
  if (state) {
    store.set('login:st-1', 'cv');
    store.set('organization:st-1', 'org-1');
  }
  const integrations = {
    hasChannel: jest.fn(async () => false),
    getIntegrationsList: jest.fn(async () => []),
    connectedThroughOtherRoute: jest.fn(async () => null),
    lockSameAccount: jest.fn(async () => null),
    unlockSameAccount: jest.fn(async () => undefined),
    checkPreviousConnections: jest.fn(async () => false),
    createOrUpdateIntegration: jest.fn(async () => ({ id: 'int-new' })),
  };
  const controller = new NoAuthIntegrationsController(
    {
      getAllowedSocialsIntegrations: () => ['facebook', 'threads'],
      getSocialIntegration: () => provider,
      isOffered: () => true,
      isPreview: () => false,
    } as any,
    integrations as any,
    { startRefreshWorkflow: jest.fn(async () => undefined) } as any,
    {
      getSessionMembership: jest.fn(async () => ({ role: 'ADMIN' })),
      getOrgById: jest.fn(async () => ORG),
    } as any,
    { getSubscriptionByOrganizationId: jest.fn(async () => null) } as any
  );
  return { controller, integrations };
};

const run = (
  controller: NoAuthIntegrationsController,
  provider: string,
  body: Record<string, unknown>,
  signedIn = true
) =>
  controller
    .connectSocialMedia(provider, { state: 'st-1', timezone: '0', ...body } as any, {
      headers: signedIn ? { auth: AuthService.signJWT({ id: 'user-1' }) } : {},
      cookies: {},
    } as any)
    .then(
      () => 'created',
      (e) =>
        e instanceof HttpException
          ? `${e.getStatus()} ${e.message}`
          : `${e?.constructor?.name} ${e?.message}`
    );

describe('POST /integrations/social-connect/:provider with sdkToken', () => {
  beforeAll(() => (process.env.JWT_SECRET = 'test-secret'));

  it('hands the SDK token to the provider instead of a code', async () => {
    const facebook = {
      isBetweenSteps: true,
      authenticate: jest.fn(),
      authenticateSdkToken: jest.fn(async () => details),
      pages: jest.fn(async () => [{ id: 'page-1' }]),
    };
    const { controller, integrations } = setup(facebook);

    expect(await run(controller, 'facebook', { sdkToken: 'EAAB-token' })).toBe(
      'created'
    );
    expect(facebook.authenticateSdkToken).toHaveBeenCalledWith('EAAB-token');
    expect(facebook.authenticate).not.toHaveBeenCalled();
    expect(integrations.createOrUpdateIntegration).toHaveBeenCalled();
    // The state is single-use, exactly as with a code.
    expect(store.has('login:st-1')).toBe(false);
  });

  it('⛔ refuses an SDK token for a platform that cannot verify one', async () => {
    const threads = { authenticate: jest.fn(async () => details) };
    const { controller, integrations } = setup(threads);

    expect(await run(controller, 'threads', { sdkToken: 'EAAB-token' })).toBe(
      '400 This platform cannot be connected with app sign-in'
    );
    expect(threads.authenticate).not.toHaveBeenCalled();
    expect(integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('⛔ still needs a state minted for the organisation', async () => {
    const facebook = {
      authenticate: jest.fn(),
      authenticateSdkToken: jest.fn(async () => details),
    };
    const { controller } = setup(facebook, false);

    expect(await run(controller, 'facebook', { sdkToken: 'EAAB-token' })).toMatch(
      /^400 This connection attempt has expired/
    );
    expect(facebook.authenticateSdkToken).not.toHaveBeenCalled();
  });

  it('⛔ still needs a signed-in member', async () => {
    const facebook = {
      authenticate: jest.fn(),
      authenticateSdkToken: jest.fn(async () => details),
    };
    const { controller } = setup(facebook);

    expect(
      await run(controller, 'facebook', { sdkToken: 'EAAB-token' }, false)
    ).toBe('401 You must be signed in to connect a channel');
    expect(facebook.authenticateSdkToken).not.toHaveBeenCalled();
  });

  it('a token the provider rejects creates no channel', async () => {
    const { NotEnoughScopes } = jest.requireActual(
      '@gitroom/nestjs-libraries/integrations/social.abstract'
    );
    const facebook = {
      authenticate: jest.fn(),
      authenticateSdkToken: jest.fn(async () => {
        throw new NotEnoughScopes(
          'This Facebook sign-in was not issued for Postra. Please try again.'
        );
      }),
    };
    const { controller, integrations } = setup(facebook);

    expect(await run(controller, 'facebook', { sdkToken: 'EAAB-token' })).toBe(
      'NotEnoughScopes This Facebook sign-in was not issued for Postra. Please try again.'
    );
    expect(integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});

describe('ConnectIntegrationDto', () => {
  const errors = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(ConnectIntegrationDto, body))).map(
      (e) => e.property
    );

  it('takes an SDK token in place of the code', async () => {
    expect(
      await errors({ state: 's', timezone: '0', sdkToken: 'EAAB-token' })
    ).toEqual([]);
  });

  it('⛔ still needs a code when there is no SDK token', async () => {
    expect(await errors({ state: 's', timezone: '0' })).toEqual(['code']);
  });

  it('⛔ refuses an oversized SDK token', async () => {
    expect(
      await errors({ state: 's', timezone: '0', sdkToken: 'x'.repeat(3000) })
    ).toEqual(['sdkToken']);
  });
});

describe('connect outcome in the logs', () => {
  beforeAll(() => (process.env.JWT_SECRET = 'test-secret'));

  it('logs the refusal with its status and message, never the token', async () => {
    const { Logger } = jest.requireActual('@nestjs/common');
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    const threads = { authenticate: jest.fn() };
    const { controller } = setup(threads);

    await run(controller, 'threads', { sdkToken: 'EAAB-secret-token' });

    const line = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain(
      '[connect] threads via sdk: refused 400 This platform cannot be connected with app sign-in'
    );
    expect(line).not.toContain('EAAB-secret-token');
    expect(line).not.toContain('st-1');
    warn.mockRestore();
  });

  it('logs a connection that went through', async () => {
    const { Logger } = jest.requireActual('@nestjs/common');
    const log = jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
    const facebook = {
      isBetweenSteps: true,
      authenticate: jest.fn(),
      authenticateSdkToken: jest.fn(async () => details),
      pages: jest.fn(async () => []),
    };
    const { controller } = setup(facebook);

    await run(controller, 'facebook', { sdkToken: 'EAAB-token' });
    expect(log.mock.calls.map((c) => String(c[0]))).toContain(
      '[connect] facebook via sdk: connected'
    );
    log.mockRestore();
  });
});
