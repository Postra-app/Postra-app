import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';
import {
  APPLE_ISSUER,
  appleClientSecret,
  exchangeAppleCode,
  resetAppleKeyCache,
  revokeAppleToken,
  sha256Hex,
  verifyAppleIdentityToken,
} from './apple.provider';

// A key pair standing in for Apple's: the public half is served as Apple's
// key set, the private half signs the tokens under test.
const apple = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid';
const jwks = {
  keys: [{ ...(apple.publicKey.export({ format: 'jwk' }) as object), kid: KID, alg: 'RS256', use: 'sig' }],
};

const NONCE = 'a-fresh-random-nonce-from-the-app';

function token(
  claims: Record<string, unknown> = {},
  opts: { key?: typeof apple.privateKey; kid?: string } = {}
) {
  return jwt.sign(
    {
      iss: APPLE_ISSUER,
      aud: 'uk.co.postra.app',
      sub: '001234.abcdef.1234',
      email: 'Someone@privaterelay.appleid.com',
      email_verified: 'true',
      nonce: sha256Hex(NONCE),
      exp: Math.floor(Date.now() / 1000) + 600,
      ...claims,
    },
    opts.key ?? apple.privateKey,
    { algorithm: 'RS256', keyid: opts.kid ?? KID }
  );
}

const fetchMock = jest.fn();

beforeEach(() => {
  resetAppleKeyCache();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === 'https://appleid.apple.com/auth/keys') {
      return { ok: true, json: async () => jwks };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  (global as any).fetch = fetchMock;
  delete process.env.APPLE_IAP_BUNDLE_ID;
});

describe('Apple identity token', () => {
  it('takes a token Apple signed for this app with the nonce the app made', async () => {
    await expect(verifyAppleIdentityToken(token(), NONCE)).resolves.toEqual({
      id: '001234.abcdef.1234',
      email: 'someone@privaterelay.appleid.com',
      verified: true,
    });
  });

  it('refuses a token whose nonce is not the hash of the value sent', async () => {
    await expect(verifyAppleIdentityToken(token(), 'another-nonce-value')).resolves.toBe(false);
    await expect(
      verifyAppleIdentityToken(token({ nonce: NONCE }), NONCE)
    ).resolves.toBe(false);
  });

  it('refuses a token issued to another app', async () => {
    await expect(
      verifyAppleIdentityToken(token({ aud: 'com.example.other' }), NONCE)
    ).resolves.toBe(false);
  });

  it('refuses a token from another issuer', async () => {
    await expect(
      verifyAppleIdentityToken(token({ iss: 'https://evil.example' }), NONCE)
    ).resolves.toBe(false);
  });

  it('refuses a token signed with a key that is not Apple\'s', async () => {
    await expect(
      verifyAppleIdentityToken(token({}, { key: stranger.privateKey }), NONCE)
    ).resolves.toBe(false);
  });

  it('refuses an expired token', async () => {
    const expired = token({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyAppleIdentityToken(expired, NONCE)).resolves.toBe(false);
  });

  it('refuses a token that names a key Apple does not publish, and does not hammer Apple', async () => {
    await expect(
      verifyAppleIdentityToken(token({}, { kid: 'unknown' }), NONCE)
    ).resolves.toBe(false);
    await expect(
      verifyAppleIdentityToken(token({}, { kid: 'unknown' }), NONCE)
    ).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads email_verified as Apple sends it, boolean or string', async () => {
    await expect(
      verifyAppleIdentityToken(token({ email_verified: true }), NONCE)
    ).resolves.toEqual(expect.objectContaining({ verified: true }));
    await expect(
      verifyAppleIdentityToken(token({ email_verified: 'false' }), NONCE)
    ).resolves.toEqual(expect.objectContaining({ verified: false }));
  });

  it('keeps Apple\'s keys between sign-ins', async () => {
    await verifyAppleIdentityToken(token(), NONCE);
    await verifyAppleIdentityToken(token(), NONCE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Apple client secret, code exchange and revocation', () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  beforeEach(() => {
    process.env.APPLE_SIGN_IN_KEY = Buffer.from(
      ec.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string
    ).toString('base64');
    process.env.APPLE_SIGN_IN_KEY_ID = 'KEY1234567';
    process.env.APPLE_SIGN_IN_TEAM_ID = '5S47VS43RB';
  });

  afterEach(() => {
    delete process.env.APPLE_SIGN_IN_KEY;
    delete process.env.APPLE_SIGN_IN_KEY_ID;
    delete process.env.APPLE_SIGN_IN_TEAM_ID;
  });

  it('signs the client secret as Apple documents it', () => {
    const secret = appleClientSecret(1_800_000_000)!;
    const { header, payload } = jwt.decode(secret, { complete: true }) as any;
    expect(header).toEqual(expect.objectContaining({ alg: 'ES256', kid: 'KEY1234567' }));
    expect(payload).toEqual({
      iss: '5S47VS43RB',
      iat: 1_800_000_000,
      exp: 1_800_000_300,
      aud: 'https://appleid.apple.com',
      sub: 'uk.co.postra.app',
    });
    expect(() =>
      jwt.verify(secret, ec.publicKey, { algorithms: ['ES256'], ignoreExpiration: true })
    ).not.toThrow();
  });

  it('has no secret, and so revokes nothing, without the key', async () => {
    delete process.env.APPLE_SIGN_IN_KEY;
    expect(appleClientSecret()).toBeNull();
    await expect(revokeAppleToken('refresh')).resolves.toBe(false);
    await expect(exchangeAppleCode('code')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('trades the authorization code for the refresh token', async () => {
    fetchMock.mockImplementation(async (url: string, init: any) => {
      expect(url).toBe('https://appleid.apple.com/auth/token');
      const form = new URLSearchParams(init.body);
      expect(form.get('client_id')).toBe('uk.co.postra.app');
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('the-code');
      expect(form.get('client_secret')).toBeTruthy();
      return { ok: true, json: async () => ({ refresh_token: 'r-123' }) };
    });
    await expect(exchangeAppleCode('the-code')).resolves.toBe('r-123');
  });

  it('revokes the refresh token', async () => {
    fetchMock.mockImplementation(async (url: string, init: any) => {
      expect(url).toBe('https://appleid.apple.com/auth/revoke');
      const form = new URLSearchParams(init.body);
      expect(form.get('token')).toBe('r-123');
      expect(form.get('token_type_hint')).toBe('refresh_token');
      expect(form.get('client_id')).toBe('uk.co.postra.app');
      return { ok: true };
    });
    await expect(revokeAppleToken('r-123')).resolves.toBe(true);
  });
});
