import { sign, verify, type SignOptions } from 'jsonwebtoken';
import { hashSync, compare } from 'bcrypt';
import crypto from 'crypto';
// @ts-ignore
import EVP_BytesToKey from 'evp_bytestokey';
import {
  decryptSecret,
  encryptSecret,
  isSecretEncrypted,
  LEGACY_TOKEN_MARKER,
  lookupHash,
} from './secrets-at-rest';
const algorithm = 'aes-256-cbc';

// The legacy scheme below (fixed IV, key from JWT_SECRET) is only read now:
// secrets-at-rest.ts has the current one and why it replaced this.

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
// Every token Postra issues is HS256. Verification used to take whatever HMAC
// the token's header named; it now names the one it accepts (RFC 8725 §3.1).
const JWT_ALGORITHM = 'HS256' as const;

export class AuthService {
  static hashPassword(password: string) {
    return hashSync(password, 10);
  }
  // Asynchronous: bcrypt takes tens of milliseconds, and compareSync held the
  // event loop for every request that long on each sign-in.
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
      algorithm: JWT_ALGORITHM,
    });
  }
  static verifyJWT(token: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not defined');
    }
    return verify(token, secret, { algorithms: [JWT_ALGORITHM] });
  }

  // A secret the app reads back later (third-party keys, custom instance
  // details): enc2:: ciphertext, see secrets-at-rest.ts.
  static encryptSecret(value: string) {
    return encryptSecret(value);
  }

  // Reads the current format and the legacy one (bare hex, fixed IV) that
  // stored values had until the backend's secrets upgrade rewrote them.
  static decryptSecret(value: string) {
    return isSecretEncrypted(value)
      ? decryptSecret(value)
      : decrypt_legacy_using_IV(value);
  }

  // What is stored for a secret Postra only compares: the organisation API
  // key, OAuth client secrets, codes and access tokens.
  static lookupHash(value: string) {
    return lookupHash(value);
  }

  // The deterministic legacy ciphertext those secrets were stored as; a row
  // the upgrade has not reached yet is still found by it.
  static legacyLookup(value: string) {
    return encrypt_legacy_using_IV(value);
  }

  // A new organisation API key: what the admin sees and sends, and the two
  // stored columns. 64 hex characters, the shape keys have always had.
  static newApiKey() {
    const key = crypto.randomBytes(32).toString('hex');
    return { key, apiKey: encryptSecret(key), apiKeyHash: lookupHash(key) };
  }

  // The key as the admin uses it. A row from before the upgrade holds the key
  // itself: the legacy ciphertext of a random id was handed out as the key.
  static apiKeyForDisplay(stored: string | null | undefined) {
    if (!stored) {
      return stored;
    }
    return isSecretEncrypted(stored) ? decryptSecret(stored) : stored;
  }

  // Encrypt a social integration token (or webhook secret) for storage at
  // rest. Idempotent: a value already in the current format, or empty/null,
  // is returned unchanged; a legacy enc:: value is re-encrypted.
  static encryptIntegrationToken(value: string): string;
  static encryptIntegrationToken(value: string | null): string | null;
  static encryptIntegrationToken(
    value: string | null | undefined
  ): string | null | undefined;
  static encryptIntegrationToken(value: string | null | undefined) {
    if (typeof value !== 'string' || value === '' || isSecretEncrypted(value)) {
      return value;
    }
    return encryptSecret(AuthService.decryptIntegrationToken(value));
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
    if (typeof value !== 'string') {
      return value;
    }
    if (isSecretEncrypted(value)) {
      return decryptSecret(value);
    }
    if (value.startsWith(LEGACY_TOKEN_MARKER)) {
      return decrypt_legacy_using_IV(value.slice(LEGACY_TOKEN_MARKER.length));
    }
    return value;
  }
}
