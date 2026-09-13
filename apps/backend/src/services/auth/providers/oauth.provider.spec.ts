import { NotFoundException } from '@nestjs/common';
import { OauthProvider } from '@gitroom/backend/services/auth/providers/oauth.provider';

// Probing /auth/oauth/GENERIC on a deployment that does not run generic OAuth
// used to throw a bare Error, so the route answered 500 and Sentry filed an
// "unhandled" issue for every bot that walked the URL. The distinction that
// matters: "not enabled here" is a 404, "enabled but half-configured" is still
// a 500, because that one is a real mistake someone needs to see.

const OAUTH_VARS = [
  'POSTRA_OAUTH_AUTH_URL',
  'POSTRA_OAUTH_CLIENT_ID',
  'POSTRA_OAUTH_CLIENT_SECRET',
  'POSTRA_OAUTH_TOKEN_URL',
  'POSTRA_OAUTH_USERINFO_URL',
];

const FULL_CONFIG: Record<string, string> = {
  POSTRA_OAUTH_AUTH_URL: 'https://sso.example.com/authorize',
  POSTRA_OAUTH_CLIENT_ID: 'client-id',
  POSTRA_OAUTH_CLIENT_SECRET: 'client-secret',
  POSTRA_OAUTH_TOKEN_URL: 'https://sso.example.com/token',
  POSTRA_OAUTH_USERINFO_URL: 'https://sso.example.com/userinfo',
};

describe('OauthProvider.generateLink', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, FRONTEND_URL: 'https://app.postra.pl' };
    OAUTH_VARS.forEach((v) => delete process.env[v]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('answers 404 when generic OAuth is not configured at all', () => {
    const provider = new OauthProvider();

    expect(() => provider.generateLink()).toThrow(NotFoundException);
  });

  it('still fails loudly when the config is only half filled', () => {
    process.env.POSTRA_OAUTH_AUTH_URL = FULL_CONFIG.POSTRA_OAUTH_AUTH_URL;
    process.env.POSTRA_OAUTH_CLIENT_ID = FULL_CONFIG.POSTRA_OAUTH_CLIENT_ID;
    const provider = new OauthProvider();

    expect(() => provider.generateLink()).toThrow(
      'POSTRA_OAUTH environment variables are not set'
    );
    expect(() => provider.generateLink()).not.toThrow(NotFoundException);
  });

  it('builds the authorize link when fully configured', () => {
    Object.assign(process.env, FULL_CONFIG);
    const provider = new OauthProvider();

    const link = provider.generateLink(undefined, 'auth-state-123');

    expect(link).toContain('https://sso.example.com/authorize?');
    expect(link).toContain('client_id=client-id');
    expect(link).toContain('state=auth-state-123');
  });
});
