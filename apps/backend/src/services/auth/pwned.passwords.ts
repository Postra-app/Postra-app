import { createHash } from 'crypto';

export const PWNED_PASSWORD_MESSAGE =
  'This password has appeared in a known data breach - please choose a different one.';

// HIBP k-anonymity range check (NIST 800-63B breached-password screening).
// Only the first 5 chars of the SHA-1 ever leave the server. Fail-open: if
// the HIBP API is down or slow, signup/reset must not be blocked by it.
export async function isPwnedPassword(password: string): Promise<boolean> {
  try {
    const sha1 = createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return false;
    }

    const body = await res.text();
    return body.split('\n').some((line) => {
      const [hashSuffix, count] = line.trim().split(':');
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
