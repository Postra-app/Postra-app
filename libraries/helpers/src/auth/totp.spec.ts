import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpSecret,
  normalizeBackupCode,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B, SHA-1: the secret is the ASCII "12345678901234567890"
// and the reference values are eight digits; six digits are their last six.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      const step = totpStep(seconds * 1000);
      expect(totpCode(RFC_SECRET, step, 8)).toBe(expected);
      expect(totpCode(RFC_SECRET, step)).toBe(expected.slice(-6));
    }
  });

  it('round-trips base32 and makes 160-bit secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(base32Decode('gezd gnbv-gy3t qojq')).toEqual(Buffer.from('1234567890'));
  });

  it('accepts the current code and one step either side, nothing further', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, totpCode(secret, step), { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), { nowMs: now })).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step + 2), { nowMs: now })).toBeNull();
  });

  it('refuses a code twice and any code older than the last one used', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    const code = totpCode(secret, step);
    expect(verifyTotp(secret, code, { nowMs: now, lastStep: step })).toBeNull();
    expect(
      verifyTotp(secret, totpCode(secret, step - 1), { nowMs: now, lastStep: step - 1 })
    ).toBeNull();
    expect(verifyTotp(secret, code, { nowMs: now, lastStep: step - 1 })).toBe(step);
  });

  it('refuses anything that is not six digits', () => {
    const secret = generateTotpSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34a6', undefined as any]) {
      expect(verifyTotp(secret, bad)).toBeNull();
    }
    const code = totpCode(secret, totpStep());
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).not.toBeNull();
  });

  it('builds the otpauth URI authenticator apps read', () => {
    const uri = otpauthUri('Postra', 'admin@example.com', 'ABCDEFGH');
    expect(uri).toBe(
      'otpauth://totp/Postra%3Aadmin%40example.com?secret=ABCDEFGH&issuer=Postra&algorithm=SHA1&digits=6&period=30'
    );
  });

  it('makes distinct, readable backup codes that survive retyping', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
      expect(normalizeBackupCode(` ${code.toUpperCase().replace('-', ' ')} `)).toBe(
        code.replace('-', '')
      );
    }
  });
});
