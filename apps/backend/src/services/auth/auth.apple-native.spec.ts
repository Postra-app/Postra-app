jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

const verifyAppleIdentityToken = jest.fn();
const exchangeAppleCode = jest.fn();
jest.mock('@gitroom/backend/services/auth/providers/apple.provider', () => ({
  appleSignInEnabled: () => process.env.APPLE_SIGN_IN_ENABLED === '1',
  verifyAppleIdentityToken: (...a: unknown[]) => verifyAppleIdentityToken(...a),
  exchangeAppleCode: (...a: unknown[]) => exchangeAppleCode(...a),
}));

import { AuthService } from './auth.service';
import { decryptSecret } from '@gitroom/helpers/auth/secrets-at-rest';

const APPLE = { id: '001234.abc', email: 'x@privaterelay.appleid.com', verified: true };
const BODY = { identityToken: 'id-token', nonce: 'raw-nonce-1234567890', authorizationCode: 'code-1' };
const SIGN_UP = { company: 'Kris', platform: 'ios' as const, ip: '1.2.3.4', userAgent: 'ua' };

function setup(user: any = null) {
  process.env.DISABLE_REGISTRATION = 'false';
  const users = {
    getUserByProvider: jest.fn(async (): Promise<any> => user),
    getOtherAccountProvider: jest.fn(async (): Promise<string | null> => null),
    setAppleRefreshToken: jest.fn(async () => ({})),
  };
  const orgs = {
    getCount: jest.fn(async () => 5),
    createOrgAndUser: jest.fn(async (body: any) => ({
      id: 'org-a',
      users: [{ user: { id: 'user-a', email: body.email, tokenVersion: 0, suspendedAt: null as Date | null, appleRefreshToken: null as string | null } }],
    })),
  };
  const service = new AuthService(users as any, orgs as any, {} as any, {} as any, {} as any);
  return { service, users, orgs };
}

describe('Sign in with Apple from the iOS app', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.APPLE_SIGN_IN_ENABLED = '1';
    verifyAppleIdentityToken.mockReset();
    exchangeAppleCode.mockReset();
  });

  it('is off until the switch is on, and then checks nothing', async () => {
    delete process.env.APPLE_SIGN_IN_ENABLED;
    const { service, users } = setup();
    await expect(service.appleNativeLogin(BODY, SIGN_UP)).resolves.toEqual({ error: 'invalid' });
    expect(verifyAppleIdentityToken).not.toHaveBeenCalled();
    expect(users.getUserByProvider).not.toHaveBeenCalled();
  });

  it('checks the token with the nonce the app sent', async () => {
    verifyAppleIdentityToken.mockResolvedValue(false);
    const { service, users } = setup();
    await expect(service.appleNativeLogin(BODY)).resolves.toEqual({ error: 'invalid' });
    expect(verifyAppleIdentityToken).toHaveBeenCalledWith('id-token', 'raw-nonce-1234567890');
    expect(users.getUserByProvider).not.toHaveBeenCalled();
  });

  it('makes the account with the Apple id and keeps the refresh token encrypted', async () => {
    verifyAppleIdentityToken.mockResolvedValue(APPLE);
    exchangeAppleCode.mockResolvedValue('apple-refresh-token');
    const { service, users, orgs } = setup();

    const result = await service.appleNativeLogin(BODY, SIGN_UP);

    expect(orgs.createOrgAndUser).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'APPLE', providerId: '001234.abc', email: 'x@privaterelay.appleid.com' }),
      '1.2.3.4',
      'ua'
    );
    expect(result).toEqual(expect.objectContaining({ created: true }));
    expect(exchangeAppleCode).toHaveBeenCalledWith('code-1');
    const [id, stored] = users.setAppleRefreshToken.mock.calls[0] as unknown as [string, string];
    expect(id).toBe('user-a');
    expect(stored).not.toContain('apple-refresh-token');
    expect(decryptSecret(stored)).toBe('apple-refresh-token');
  });

  // The newest refresh token is kept: revoking one Apple has replaced would
  // leave the sign-in standing.
  it('signs in an existing Apple account and keeps its newest refresh token', async () => {
    verifyAppleIdentityToken.mockResolvedValue(APPLE);
    exchangeAppleCode.mockResolvedValue('newer-refresh');
    const existing = { id: 'user-a', email: APPLE.email, tokenVersion: 0, suspendedAt: null as Date | null, appleRefreshToken: 'enc' };
    const { service, orgs, users } = setup(existing);

    const result = await service.appleNativeLogin(BODY);

    expect(result).toEqual(expect.objectContaining({ created: false }));
    expect(orgs.createOrgAndUser).not.toHaveBeenCalled();
    expect(exchangeAppleCode).toHaveBeenCalledWith('code-1');
    expect(decryptSecret((users.setAppleRefreshToken.mock.calls[0] as unknown as [string, string])[1])).toBe('newer-refresh');
  });

  it('keeps the sign-in when Apple refuses the code', async () => {
    verifyAppleIdentityToken.mockResolvedValue(APPLE);
    exchangeAppleCode.mockRejectedValue(new Error('timeout'));
    const { service, users } = setup();

    await expect(service.appleNativeLogin(BODY, SIGN_UP)).resolves.toEqual(
      expect.objectContaining({ created: true })
    );
    expect(users.setAppleRefreshToken).not.toHaveBeenCalled();
  });
});
