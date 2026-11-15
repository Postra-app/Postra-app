import { createSign, generateKeyPairSync } from 'crypto';
import { AppleIapVerifier } from '@gitroom/nestjs-libraries/services/apple/apple.iap.verifier';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

// A transaction signed by someone who is not Apple: a well-formed JWS over a
// plausible payload, with a key and a certificate chain of the forger's own.
const forged = (payload: Record<string, unknown>, x5c: string[]) => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const head = b64({ alg: 'ES256', x5c });
  const body = b64(payload);
  const signature = createSign('SHA256')
    .update(`${head}.${body}`)
    .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${head}.${body}.${signature}`;
};

const PAYLOAD = {
  originalTransactionId: '2000000000000001',
  bundleId: 'uk.co.postra.app',
  productId: 'uk.co.postra.app.business.monthly',
  expiresDate: Date.now() + 86_400_000,
  environment: 'Production',
};

describe('AppleIapVerifier', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('rejects a transaction that carries no Apple certificate chain', async () => {
    await expect(new AppleIapVerifier().transaction(forged(PAYLOAD, []))).rejects.toBeDefined();
  });

  it('rejects a chain that does not lead to Apple, whatever environment it claims', async () => {
    const junk = Buffer.from('not a certificate').toString('base64');
    for (const environment of ['Production', 'Sandbox', 'Xcode']) {
      await expect(
        new AppleIapVerifier().transaction(forged({ ...PAYLOAD, environment }, [junk, junk, junk]))
      ).rejects.toBeDefined();
    }
  });

  it('rejects a forged notification', async () => {
    await expect(
      new AppleIapVerifier().notification(forged({ notificationType: 'DID_RENEW' }, []))
    ).rejects.toBeDefined();
  });

  it('unsigned Xcode test purchases are never accepted in production, even if asked for', async () => {
    process.env.APPLE_IAP_LOCAL_TESTING = '1';
    process.env.NODE_ENV = 'production';
    await expect(
      new AppleIapVerifier().transaction(forged({ ...PAYLOAD, environment: 'Xcode' }, []))
    ).rejects.toBeDefined();
  });

  it('they are accepted on a developer machine that asks for them', async () => {
    process.env.APPLE_IAP_LOCAL_TESTING = '1';
    process.env.NODE_ENV = 'development';
    await expect(
      new AppleIapVerifier().transaction(forged({ ...PAYLOAD, environment: 'Xcode' }, []))
    ).resolves.toMatchObject({ originalTransactionId: '2000000000000001', environment: 'Xcode' });
  });
});
