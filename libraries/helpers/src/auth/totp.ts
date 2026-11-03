import crypto from 'crypto';

// Time-based one-time passwords (RFC 6238 over RFC 4226): HMAC-SHA1, 30-second
// steps, six digits. That is what every authenticator app reads from an
// otpauth:// QR code, so nothing here is configurable. No dependency: the
// whole algorithm is the twenty lines below, checked against the RFC's own
// test vectors (totp.spec.ts).

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
// A code from the step before or after the current one is accepted too: a
// phone clock a few seconds off, or a code typed as it rolled over.
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) {
      throw new Error('Invalid base32 secret');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 160 bits, the length RFC 4226 recommends for HMAC-SHA1.
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(
  secret: string,
  step: number,
  digits: number = TOTP_DIGITS
): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto
    .createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The step the code belongs to, or null.
 *
 * `lastStep` is the step of the last code accepted for this secret: a code is
 * good once (RFC 6238 §5.2), so the same code, or one from an earlier step,
 * read over a shoulder or out of a log, is refused.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { nowMs?: number; lastStep?: number | null } = {}
): number | null {
  if (typeof code !== 'string') {
    return null;
  }
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) {
    return null;
  }
  const current = totpStep(options.nowMs);
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const step = current + delta;
    if (options.lastStep != null && step <= options.lastStep) {
      continue;
    }
    const expected = totpCode(secret, step);
    if (
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))
    ) {
      return step;
    }
  }
  return null;
}

export function otpauthUri(issuer: string, account: string, secret: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Backup codes: ten of them, each good once, for a lost phone. 10 characters
// from an alphabet without look-alikes (no 0/O, 1/I/L), shown as xxxxx-xxxxx.
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const BACKUP_CODE_COUNT = 10;

export function generateBackupCodes(count: number = BACKUP_CODE_COUNT) {
  return Array.from({ length: count }, () => {
    const chars = Array.from(
      { length: 10 },
      () => BACKUP_ALPHABET[crypto.randomInt(BACKUP_ALPHABET.length)]
    ).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

// What is typed back: case, spaces and the dash do not matter.
export function normalizeBackupCode(code: string) {
  if (typeof code !== 'string') {
    return '';
  }
  return code
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
