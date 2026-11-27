import { createHash, createPublicKey, KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { appleBundleId } from '@gitroom/nestjs-libraries/services/apple/apple.iap';

// Sign in with Apple from the iOS app (App Review 4.8: an app that signs in
// with Google must offer it too). There is no web flow: the app's native
// sheet returns an identity token and a one-time authorization code, and
// the server checks them as Apple's documentation says:
// https://developer.apple.com/documentation/signinwithapple/verifying-a-user
// https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens
// https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens
export const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

// The app's App ID is the client id of a native sign-in, and the audience
// of its identity tokens.
export const appleClientId = () => appleBundleId();

// Offered only where it is switched on: the iOS app shows the button only
// when the server says so, and the switch goes on once the App ID has the
// capability.
export const appleSignInEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.APPLE_SIGN_IN_ENABLED === '1';

export const sha256Hex = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

type AppleJwk = { kid: string; kty: string; alg?: string; [k: string]: unknown };

// Apple rotates its keys and may publish several; a token names its key by
// `kid`. The set is kept for an hour and fetched again early only for a kid
// it does not have, at most once a minute.
let keyCache: { at: number; keys: Map<string, KeyObject> } | undefined;
const KEYS_TTL_MS = 60 * 60 * 1000;
const REFETCH_GAP_MS = 60 * 1000;

export const resetAppleKeyCache = () => {
  keyCache = undefined;
};

async function fetchKeys(): Promise<Map<string, KeyObject>> {
  const res = await fetch(APPLE_KEYS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`Apple keys: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { keys?: AppleJwk[] };
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys || []) {
    if (jwk?.kid) {
      keys.set(jwk.kid, createPublicKey({ key: jwk as any, format: 'jwk' }));
    }
  }
  keyCache = { at: Date.now(), keys };
  return keys;
}

async function keyFor(kid: string): Promise<KeyObject | undefined> {
  const fresh = keyCache && Date.now() - keyCache.at < KEYS_TTL_MS;
  if (fresh && keyCache!.keys.has(kid)) {
    return keyCache!.keys.get(kid);
  }
  if (fresh && Date.now() - keyCache!.at < REFETCH_GAP_MS) {
    return undefined;
  }
  return (await fetchKeys()).get(kid);
}

export type AppleIdentity = { id: string; email: string; verified: boolean };

/**
 * Checks an identity token from the app: Apple's signature, issuer, the
 * app's client id as audience, expiry, and the nonce. The app hashes a fresh
 * random nonce into the request and sends the raw value here; the token
 * carries the hash, so a token taken from somewhere else cannot be replayed
 * without the value that went with it. `sub` is the account's stable id for
 * this team. Apple puts the address in every identity token; it may be a
 * private relay address, which Apple has verified as well.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  rawNonce: string
): Promise<AppleIdentity | false> {
  if (!identityToken || !rawNonce) return false;
  try {
    const decoded = jwt.decode(identityToken, { complete: true });
    const kid = decoded && typeof decoded === 'object' ? decoded.header?.kid : undefined;
    if (!kid) return false;
    const key = await keyFor(kid);
    if (!key) return false;
    const payload = jwt.verify(identityToken, key, {
      algorithms: ['RS256', 'ES256'],
      issuer: APPLE_ISSUER,
      audience: appleClientId(),
    }) as jwt.JwtPayload & {
      email?: string;
      email_verified?: boolean | string;
      nonce?: string;
    };
    if (!payload.sub || payload.nonce !== sha256Hex(rawNonce)) {
      return false;
    }
    if (!payload.email) return false;
    const verified =
      payload.email_verified === true || payload.email_verified === 'true';
    return { id: payload.sub, email: payload.email.toLowerCase(), verified };
  } catch {
    return false;
  }
}

// The Sign in with Apple key from the developer account (Certificates,
// Identifiers & Profiles > Keys), the .p8 base64-encoded on one line like
// the In-App Purchase key; its Key ID; the Team ID. Null when any is
// missing: sign-in still works, but nothing can be revoked.
const appleKeyConfig = () => {
  const raw = process.env.APPLE_SIGN_IN_KEY?.trim();
  const keyId = process.env.APPLE_SIGN_IN_KEY_ID?.trim();
  const teamId = process.env.APPLE_SIGN_IN_TEAM_ID?.trim();
  if (!raw || !keyId || !teamId) return null;
  const key = raw.includes('BEGIN')
    ? raw.replace(/\\n/g, '\n')
    : Buffer.from(raw, 'base64').toString('utf8');
  return { key, keyId, teamId };
};

export const appleRevocationConfigured = () => !!appleKeyConfig();

// The client secret Apple's token and revoke endpoints ask for: a JWT signed
// with the key (ES256), issued by the team, for this client. Five minutes is
// enough for the one request it is made for; Apple allows up to six months.
export function appleClientSecret(now = Math.floor(Date.now() / 1000)) {
  const config = appleKeyConfig();
  if (!config) return null;
  return jwt.sign(
    {
      iss: config.teamId,
      iat: now,
      exp: now + 300,
      aud: APPLE_ISSUER,
      sub: appleClientId(),
    },
    config.key,
    { algorithm: 'ES256', keyid: config.keyId }
  );
}

/**
 * Trades the one-time authorization code from the app (valid five minutes)
 * for Apple's refresh token, the token revocation needs later. Null when the
 * key is not configured or Apple refuses; the sign-in itself does not depend
 * on it.
 */
export async function exchangeAppleCode(code: string): Promise<string | null> {
  const secret = appleClientSecret();
  if (!secret || !code) return null;
  const res = await fetch(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appleClientId(),
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { refresh_token?: string };
  return body.refresh_token || null;
}

// Ends the app's access to the person's Apple sign-in. Apple answers 200
// also for a token that was already invalid.
export async function revokeAppleToken(refreshToken: string): Promise<boolean> {
  const secret = appleClientSecret();
  if (!secret || !refreshToken) return false;
  const res = await fetch(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appleClientId(),
      client_secret: secret,
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

// No class in the provider registry: there is no redirect flow, so the web
// routes (/auth/oauth/APPLE, a register body with provider APPLE) answer as
// for any provider they do not know. The app's route calls the functions
// above directly.
