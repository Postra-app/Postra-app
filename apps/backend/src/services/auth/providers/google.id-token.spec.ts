import { generateKeyPairSync, createSign } from 'crypto';
import { google } from 'googleapis';
import { GoogleProvider, googleIdTokenVerifier } from './google.provider';

// Real signatures, real checks: only the download of Google's public keys is
// replaced by a key made here, so audience, issuer, expiry and the signature
// itself go through the library exactly as in production.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const KID = 'test-key';
const WEB_CLIENT = 'web-client.apps.googleusercontent.com';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown>, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: KID, typ: 'JWT' });
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: WEB_CLIENT,
    azp: 'ios-client.apps.googleusercontent.com',
    sub: '1234567890',
    email: 'someone@example.com',
    email_verified: true,
    iat: now,
    exp: now + 3600,
    ...claims,
  });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key);
  return `${head}.${body}.${sig.toString('base64url')}`;
}

describe('Google ID token from the mobile app', () => {
  const provider = new GoogleProvider();
  let certs: jest.SpyInstance;

  beforeEach(() => {
    process.env.YOUTUBE_CLIENT_ID = WEB_CLIENT;
    certs = jest
      .spyOn(google.auth.OAuth2.prototype, 'getFederatedSignonCertsAsync')
      .mockResolvedValue({
        certs: { [KID]: publicKey.export({ type: 'spki', format: 'pem' }) },
        format: 'PEM',
      } as any);
  });
  afterEach(() => certs.mockRestore());

  it('gives the Google id and address of a good token', async () => {
    await expect(provider.verifyIdToken(idToken({}))).resolves.toEqual({
      id: '1234567890',
      email: 'someone@example.com',
    });
  });

  it('refuses a token made for another app', async () => {
    await expect(
      provider.verifyIdToken(idToken({ aud: 'someone-else.apps.googleusercontent.com' }))
    ).resolves.toBe(false);
  });

  it('refuses a token signed by anyone but Google', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(provider.verifyIdToken(idToken({}, other))).resolves.toBe(false);
  });

  it('refuses an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    await expect(
      provider.verifyIdToken(idToken({ iat: past - 3600, exp: past }))
    ).resolves.toBe(false);
  });

  it('refuses a token from another issuer', async () => {
    await expect(
      provider.verifyIdToken(idToken({ iss: 'https://evil.example' }))
    ).resolves.toBe(false);
  });

  it('refuses an address Google has not verified', async () => {
    await expect(
      provider.verifyIdToken(idToken({ email_verified: false }))
    ).resolves.toBe(false);
  });

  it('refuses everything when the web client is not configured', async () => {
    delete process.env.YOUTUBE_CLIENT_ID;
    await expect(provider.verifyIdToken(idToken({}))).resolves.toBe(false);
    expect(certs).not.toHaveBeenCalled();
  });

  // A new client per sign-in threw away the keys the last one had fetched.
  it('verifies every sign-in with the same client, so Google keys are kept between them', async () => {
    const seen = new Set<unknown>();
    const verify = jest.spyOn(google.auth.OAuth2.prototype, 'verifyIdToken');
    verify.mockImplementation(function (this: unknown) {
      seen.add(this);
      return Promise.reject(new Error('stop'));
    } as any);
    await provider.verifyIdToken(idToken({}));
    await provider.verifyIdToken(idToken({}));
    expect(verify).toHaveBeenCalledTimes(2);
    expect([...seen]).toEqual([googleIdTokenVerifier()]);
    verify.mockRestore();
  });

  it('refuses rubbish without throwing', async () => {
    await expect(provider.verifyIdToken('not.a.token')).resolves.toBe(false);
  });
});
