import { OAuthService } from './oauth.service';
import {
  AuthService,
  encrypt_legacy_using_IV,
} from '@gitroom/helpers/auth/auth.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

// Client secrets, codes and tokens are stored as their SHA-256; rows from
// before hold the legacy ciphertext until
// the backend's secrets upgrade rewrites them, possibly mid-exchange.
describe('OAuth secrets in either stored form', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'jwt-secret-for-tests';
  });

  const service = (repo: Record<string, jest.Mock>) =>
    new OAuthService(repo as never);

  const app = (clientSecret: string) => ({
    id: 'app-1',
    dynamic: false,
    clientSecret,
    redirectUrl: 'https://example.com/callback',
  });

  const authorization = (authorizationCode: string) => ({
    id: 'auth-1',
    oauthAppId: 'app-1',
    organizationId: 'org-1',
    authorizationCode,
    codeChallenge: null,
    redirectUri: null,
    codeExpiresAt: new Date(Date.now() + 60_000),
  });

  it.each([
    ['legacy', (v: string) => encrypt_legacy_using_IV(v)],
    ['hashed', (v: string) => AuthService.lookupHash(v)],
  ])('exchanges a %s code with a %s-stored secret', async (_, stored) => {
    const repo = {
      getAppByClientId: jest.fn().mockResolvedValue(app(stored('pcs_secret'))),
      findByCode: jest.fn().mockResolvedValue(authorization(stored('code-1'))),
      exchangeCodeForToken: jest.fn().mockResolvedValue(1),
    };
    const result = await service(repo).exchangeCodeForToken(
      'code-1',
      'pca_client',
      'pcs_secret'
    );
    expect(result.access_token).toMatch(/^pos_/);
    // The token goes in as its hash only.
    expect(repo.exchangeCodeForToken.mock.calls[0][2]).toBe(
      AuthService.lookupHash(result.access_token)
    );
  });

  // The upgrade turned the legacy code into its hash after findByCode read
  // it: the write must still match the row.
  it('spends the code in whichever form the row holds when it writes', async () => {
    const repo = {
      getAppByClientId: jest
        .fn()
        .mockResolvedValue(app(AuthService.lookupHash('pcs_secret'))),
      findByCode: jest
        .fn()
        .mockResolvedValue(authorization(encrypt_legacy_using_IV('code-1'))),
      exchangeCodeForToken: jest.fn().mockResolvedValue(1),
    };
    await service(repo).exchangeCodeForToken('code-1', 'pca_client', 'pcs_secret');
    expect(repo.exchangeCodeForToken.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        AuthService.lookupHash('code-1'),
        encrypt_legacy_using_IV('code-1'),
      ])
    );
  });

  it('refuses a wrong client secret in either form', async () => {
    for (const stored of [
      encrypt_legacy_using_IV('pcs_secret'),
      AuthService.lookupHash('pcs_secret'),
    ]) {
      const repo = {
        getAppByClientId: jest.fn().mockResolvedValue(app(stored)),
        findByCode: jest.fn(),
        exchangeCodeForToken: jest.fn(),
      };
      await expect(
        service(repo).exchangeCodeForToken('code-1', 'pca_client', 'pcs_wrong')
      ).rejects.toMatchObject({ status: 401 });
      expect(repo.findByCode).not.toHaveBeenCalled();
    }
  });
});
