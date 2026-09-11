/**
 * Strip credential material out of anything on its way to storage, a screen or
 * a clipboard.
 *
 * The reason this exists: a failed publish writes the whole in-flight post list
 * into `Errors.body`, and those posts carry their full `Integration` row
 * because publishing needs the token. Providers that refresh tokens (Instagram,
 * YouTube) hand back a *plaintext* access token that the workflow writes onto
 * the same object, so the row that lands in `Errors` can hold a working
 * credential. The admin panel then shows it under "View" and copies it with
 * "Copy Debug Code" (e2e/bugs.md — E2E-09-01).
 *
 * The blocklist is keyed by name rather than by shape on purpose. `body` is an
 * arbitrary error payload — provider responses, nested settings, whatever the
 * failing platform returned — so a shape-aware strip would only cover the
 * columns we happen to know about today.
 */

export const REDACTED = '[redacted]';

// Compared case-insensitively with `_` and `-` removed, so `refreshToken`,
// `refresh_token` and `REFRESH-TOKEN` all match the same entry.
const SECRET_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearertoken',
  'apikey',
  'apisecret',
  'clientsecret',
  'appsecret',
  'secret',
  'password',
  'authorization',
  'custominstancedetails',
]);

const normalizeKey = (key: string) =>
  key.toLowerCase().replace(/[_-]/g, '');

export const isSecretKey = (key: string) => SECRET_KEYS.has(normalizeKey(key));

/**
 * Deep copy with every secret-named value replaced. Non-plain objects (Date,
 * Buffer, class instances) are passed through untouched — they are not the
 * shape credentials arrive in, and rebuilding them would change the payload.
 */
export function redactSecrets<T>(value: T, seen = new WeakSet()): T {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    return value.map((item) => redactSecrets(item, seen)) as unknown as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      isSecretKey(key) && item !== null && item !== undefined
        ? REDACTED
        : redactSecrets(item, seen);
  }

  return out as unknown as T;
}

/**
 * Same thing for a value that is already serialised. Used on `Errors.body`,
 * which is a JSON string in the database.
 *
 * A body that does not parse is left alone: those are plain error messages, and
 * a regex scrub over free text would mangle the message without a matching key
 * to anchor on.
 */
export function redactSecretsInJson(body: string | null | undefined): string {
  if (!body) {
    return body ?? '';
  }

  try {
    return JSON.stringify(redactSecrets(JSON.parse(body)));
  } catch {
    return body;
  }
}

/** True when the serialised value still carries a live secret-named field. */
export function hasSecrets(body: string | null | undefined): boolean {
  if (!body) {
    return false;
  }

  try {
    return JSON.stringify(JSON.parse(body)) !== redactSecretsInJson(body);
  } catch {
    return false;
  }
}
