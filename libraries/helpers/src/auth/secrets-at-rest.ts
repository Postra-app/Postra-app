import crypto from 'crypto';

// Secrets the app has to read back (channel tokens, webhook secrets, custom
// instance details, third-party keys) are stored as
//   enc2::<kid>:<base64url(nonce | ciphertext | tag)>
// AES-256-GCM with a random 96-bit nonce per value, authenticated, under the
// key named by kid. Values that are only ever compared (the organisation API
// key, OAuth client secrets, codes and tokens) are not stored reversibly at
// all: lookupHash() below.
//
// Before this format everything went through AES-256-CBC with a fixed IV and a
// key derived from JWT_SECRET (no salt, MD5): one value always gave the same
// ciphertext, nothing detected tampering, and the JWT signing secret could
// not change without losing every stored token. The legacy
// format is still read, and the backend rewrites it at start
// (secrets-upgrade.service.ts).
//
// Keys: TOKEN_ENCRYPTION_KEYS = "kid:secret[,kid:secret...]", the first one
// encrypts, every one decrypts, so a rotation puts a new key first; the
// backend re-encrypts what is under the others at start, and the old pair is
// dropped once nothing is left under it. Without the variable (local
// development, a self-hosted install that has not set it) the key is derived
// from JWT_SECRET under kid "jwt", and that key keeps decrypting after the
// variable is set, until the upgrade has moved its rows.

export const SECRET_MARKER = 'enc2::';
export const LEGACY_TOKEN_MARKER = 'enc::';
export const LOOKUP_MARKER = 'sha256:';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

type Keyring = { active: string; keys: Map<string, Buffer> };

let cached: { source: string; keyring: Keyring } | undefined;

function deriveKey(secret: string, kid: string) {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('postra-secrets-at-rest', 'utf8'),
      Buffer.from(`${SECRET_MARKER}${kid}`, 'utf8'),
      32
    )
  );
}

function keyring(): Keyring {
  const configured = process.env.TOKEN_ENCRYPTION_KEYS?.trim();
  const jwtSecret = process.env.JWT_SECRET ?? '';
  const source = configured || `jwt:${jwtSecret}`;
  const cacheKey = `${source}\n${jwtSecret}`;
  if (cached?.source === cacheKey) {
    return cached.keyring;
  }

  const keys = new Map<string, Buffer>();
  let active = '';
  for (const entry of source.split(',')) {
    const at = entry.indexOf(':');
    const kid = entry.slice(0, at).trim();
    const secret = entry.slice(at + 1).trim();
    if (at < 1 || !KID_PATTERN.test(kid) || keys.has(kid)) {
      throw new Error('TOKEN_ENCRYPTION_KEYS: expected "kid:secret[,kid:secret...]" with unique kids');
    }
    // 32 characters of random letters and digits are ~190 bits.
    if (configured && secret.length < 32) {
      throw new Error(
        `TOKEN_ENCRYPTION_KEYS: the secret of "${kid}" is shorter than 32 characters`
      );
    }
    if (!secret) {
      throw new Error('Neither TOKEN_ENCRYPTION_KEYS nor JWT_SECRET is defined');
    }
    keys.set(kid, deriveKey(secret, kid));
    active ||= kid;
  }

  if (configured && !keys.has('jwt') && jwtSecret) {
    keys.set('jwt', deriveKey(jwtSecret, 'jwt'));
  }

  cached = { source: cacheKey, keyring: { active, keys } };
  return cached.keyring;
}

export function encryptSecret(plaintext: string) {
  const { active, keys } = keyring();
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keys.get(active)!, nonce);
  cipher.setAAD(Buffer.from(`${SECRET_MARKER}${active}`, 'utf8'));
  const body = Buffer.concat([
    nonce,
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${SECRET_MARKER}${active}:${body.toString('base64url')}`;
}

// The start of every value written under the key that encrypts now; the
// backend's upgrade rewrites stored values that do not start with it.
export function currentSecretPrefix() {
  return `${SECRET_MARKER}${keyring().active}:`;
}

export function isSecretEncrypted(value: string) {
  return value.startsWith(SECRET_MARKER);
}

// Only for a value in the current format: throws when it was changed, cut
// short or written under a key that is no longer configured.
export function decryptSecret(value: string) {
  const rest = value.slice(SECRET_MARKER.length);
  const colon = rest.indexOf(':');
  const kid = rest.slice(0, colon);
  const key = colon > 0 ? keyring().keys.get(kid) : undefined;
  if (!isSecretEncrypted(value) || !key) {
    throw new Error(`Stored secret under an unknown key "${kid}"`);
  }
  const body = Buffer.from(rest.slice(colon + 1), 'base64url');
  if (body.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('Stored secret is truncated');
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    body.subarray(0, NONCE_BYTES)
  );
  decipher.setAAD(Buffer.from(`${SECRET_MARKER}${kid}`, 'utf8'));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(body.subarray(NONCE_BYTES, body.length - TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

// The value Postra keeps for a secret it only compares. Every such secret is
// random and long (an API key, a client secret, a code, a token), so a plain
// SHA-256 cannot be reversed or guessed, and needs no key that could rotate
// away from the rows already written.
export function lookupHash(value: string) {
  return (
    LOOKUP_MARKER + crypto.createHash('sha256').update(value, 'utf8').digest('hex')
  );
}

// Tests change the environment between cases.
export function resetSecretKeysForTests() {
  cached = undefined;
}
