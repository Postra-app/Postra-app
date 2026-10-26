import { sign, verify, type SignOptions } from 'jsonwebtoken';
import { hashSync, compare } from 'bcrypt';
import crypto from 'crypto';
// @ts-ignore
import EVP_BytesToKey from 'evp_bytestokey';
const algorithm = 'aes-256-cbc';
const { keyLength, ivLength } = crypto.getCipherInfo(algorithm);

// Prefix that marks an integration token/refreshToken as encrypted-at-rest.
// Real provider tokens never start with this, and the cipher output is hex,
// so the marker can never collide — making encrypt/decrypt idempotent and
// backward-compatible with legacy plaintext rows (which simply pass through).
const INTEGRATION_TOKEN_MARKER = 'enc::';

function deriveLegacyKeyIv(secret: string) {
  const { keyLength, ivLength } = crypto.getCipherInfo(algorithm); // 32, 16
  const pass = Buffer.isBuffer(secret)
    ? secret
    : Buffer.from(secret ?? '', 'utf8');

  // evp_bytestokey: key length in **bits**, IV length in **bytes**
  const { key, iv } = EVP_BytesToKey(
    pass,
    null,
    keyLength * 8,
    ivLength,
    'md5'
  );

  if (key.length !== keyLength || iv.length !== ivLength) {
    throw new Error(`Derived wrong sizes (key=${key.length}, iv=${iv.length})`);
  }
  return { key, iv };
}

export function decrypt_legacy_using_IV(hexCiphertext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const out = Buffer.concat([
    decipher.update(hexCiphertext, 'hex'),
    decipher.final(),
  ]);
  return out.toString('utf8');
}

export function encrypt_legacy_using_IV(utf8Plaintext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const out = Buffer.concat([
    cipher.update(utf8Plaintext, 'utf8'),
    cipher.final(),
  ]);
  return out.toString('hex');
}
export class AuthService {
  static hashPassword(password: string) {
    return hashSync(password, 10);
  }
  // Asynchronous: bcrypt takes tens of milliseconds, and compareSync held the
  // event loop for every request that long on each sign-in (E2E-11-73).
  static comparePassword(password: string, hash: string) {
    return compare(password, hash);
  }
  static signJWT(value: object, options?: SignOptions) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not defined');
    }
    return sign(value, secret, {
      expiresIn: '30d',
      ...options,
    });
  }
  static verifyJWT(token: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not defined');
    }
    return verify(token, secret);
  }

  static fixedEncryption(value: string) {
    return encrypt_legacy_using_IV(value);
  }

  static fixedDecryption(hash: string) {
    return decrypt_legacy_using_IV(hash);
  }

  // Encrypt a social integration token for storage at rest. Idempotent: an
  // already-encrypted value (or empty/null) is returned unchanged, so it is
  // safe to call on values that may already be encrypted.
  static encryptIntegrationToken(value: string): string;
  static encryptIntegrationToken(value: string | null): string | null;
  static encryptIntegrationToken(
    value: string | null | undefined
  ): string | null | undefined;
  static encryptIntegrationToken(value: string | null | undefined) {
    if (typeof value !== 'string' || value === '') {
      return value;
    }
    if (value.startsWith(INTEGRATION_TOKEN_MARKER)) {
      return value;
    }
    return INTEGRATION_TOKEN_MARKER + encrypt_legacy_using_IV(value);
  }

  // Decrypt a stored integration token. Idempotent: a plaintext value (legacy
  // row, or a freshly-refreshed token still in memory) has no marker and is
  // returned unchanged, so it is safe to call at any consumption point.
  static decryptIntegrationToken(value: string): string;
  static decryptIntegrationToken(value: string | null): string | null;
  static decryptIntegrationToken(
    value: string | null | undefined
  ): string | null | undefined;
  static decryptIntegrationToken(value: string | null | undefined) {
    if (
      typeof value !== 'string' ||
      !value.startsWith(INTEGRATION_TOKEN_MARKER)
    ) {
      return value;
    }
    return decrypt_legacy_using_IV(
      value.slice(INTEGRATION_TOKEN_MARKER.length)
    );
  }
}
