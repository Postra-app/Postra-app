import {
  currentSecretPrefix,
  decryptSecret,
  encryptSecret,
  lookupHash,
  resetSecretKeysForTests,
} from './secrets-at-rest';
import {
  AuthService,
  encrypt_legacy_using_IV,
} from './auth.service';

const KEY_A = 'a'.repeat(16) + 'A1b2C3d4E5f6G7h8I9j0';
const KEY_B = 'b'.repeat(16) + 'Z9y8X7w6V5u4T3s2R1q0';

describe('secrets at rest', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'jwt-secret-for-tests';
    process.env.TOKEN_ENCRYPTION_KEYS = `k1:${KEY_A}`;
    resetSecretKeysForTests();
  });

  afterAll(() => {
    delete process.env.TOKEN_ENCRYPTION_KEYS;
    resetSecretKeysForTests();
  });

  it('round-trips and names the key', () => {
    const stored = encryptSecret('channel-token');
    expect(stored).toMatch(/^enc2::k1:[A-Za-z0-9_-]+$/);
    expect(decryptSecret(stored)).toBe('channel-token');
  });

  // The legacy scheme had a fixed IV: one token, one ciphertext, every time.
  it('never gives the same ciphertext twice', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
    expect(encrypt_legacy_using_IV('same')).toBe(encrypt_legacy_using_IV('same'));
  });

  // CBC without a tag decrypted a changed ciphertext into garbage silently.
  it('refuses a changed ciphertext', () => {
    const stored = encryptSecret('channel-token');
    const body = Buffer.from(stored.split(':').pop()!, 'base64url');
    body[body.length - 20] ^= 1;
    const changed = `enc2::k1:${body.toString('base64url')}`;
    expect(() => decryptSecret(changed)).toThrow();
  });

  it('refuses a ciphertext moved under another key id', () => {
    process.env.TOKEN_ENCRYPTION_KEYS = `k2:${KEY_A},k1:${KEY_A}`;
    resetSecretKeysForTests();
    const stored = encryptSecret('x');
    expect(() => decryptSecret(stored.replace('enc2::k2:', 'enc2::k1:'))).toThrow();
  });

  it('rotates: the first key encrypts, the old one still decrypts', () => {
    const old = encryptSecret('before rotation');
    process.env.TOKEN_ENCRYPTION_KEYS = `k2:${KEY_B},k1:${KEY_A}`;
    resetSecretKeysForTests();
    expect(encryptSecret('after')).toMatch(/^enc2::k2:/);
    expect(decryptSecret(old)).toBe('before rotation');
  });

  it('fails loudly for a value under a key that is gone', () => {
    const old = encryptSecret('x');
    process.env.TOKEN_ENCRYPTION_KEYS = `k2:${KEY_B}`;
    resetSecretKeysForTests();
    expect(() => decryptSecret(old)).toThrow(/unknown key "k1"/);
  });

  // A changed JWT_SECRET used to make every stored token unreadable.
  it('does not depend on JWT_SECRET once keys are set', () => {
    const stored = encryptSecret('x');
    process.env.JWT_SECRET = 'rotated-jwt-secret';
    resetSecretKeysForTests();
    expect(decryptSecret(stored)).toBe('x');
  });

  it('derives a key from JWT_SECRET when none is set', () => {
    delete process.env.TOKEN_ENCRYPTION_KEYS;
    resetSecretKeysForTests();
    const stored = encryptSecret('x');
    expect(stored).toMatch(/^enc2::jwt:/);
    expect(decryptSecret(stored)).toBe('x');
  });

  // A value written before TOKEN_ENCRYPTION_KEYS reached the instance stays
  // readable, and the upgrade sees it is not under the current key.
  it('keeps reading values under the JWT_SECRET key after keys are set', () => {
    delete process.env.TOKEN_ENCRYPTION_KEYS;
    resetSecretKeysForTests();
    const before = encryptSecret('x');
    process.env.TOKEN_ENCRYPTION_KEYS = `k1:${KEY_A}`;
    resetSecretKeysForTests();
    expect(decryptSecret(before)).toBe('x');
    expect(before.startsWith(currentSecretPrefix())).toBe(false);
    expect(encryptSecret('y').startsWith(currentSecretPrefix())).toBe(true);
  });

  it.each(['k1', 'k1:short', `bad kid:${KEY_A}`, `k1:${KEY_A},k1:${KEY_B}`])(
    'refuses the key list %s',
    (keys) => {
      process.env.TOKEN_ENCRYPTION_KEYS = keys;
      resetSecretKeysForTests();
      expect(() => encryptSecret('x')).toThrow(/TOKEN_ENCRYPTION_KEYS/);
    }
  );

  it('hashes compared values without a key', () => {
    expect(lookupHash('pos_token')).toMatch(/^sha256:[0-9a-f]{64}$/);
    process.env.TOKEN_ENCRYPTION_KEYS = `k2:${KEY_B}`;
    resetSecretKeysForTests();
    expect(lookupHash('pos_token')).toBe(lookupHash('pos_token'));
  });

  describe('AuthService', () => {
    it('reads legacy integration tokens and plaintext', () => {
      const legacy = 'enc::' + encrypt_legacy_using_IV('old-token');
      expect(AuthService.decryptIntegrationToken(legacy)).toBe('old-token');
      expect(AuthService.decryptIntegrationToken('plain')).toBe('plain');
      expect(AuthService.decryptIntegrationToken(null)).toBeNull();
    });

    it('upgrades a legacy token and leaves a current one as it is', () => {
      const legacy = 'enc::' + encrypt_legacy_using_IV('old-token');
      const upgraded = AuthService.encryptIntegrationToken(legacy);
      expect(upgraded).toMatch(/^enc2::k1:/);
      expect(AuthService.decryptIntegrationToken(upgraded)).toBe('old-token');
      expect(AuthService.encryptIntegrationToken(upgraded)).toBe(upgraded);
      expect(AuthService.encryptIntegrationToken('')).toBe('');
    });

    it('reads secrets in both formats', () => {
      expect(AuthService.decryptSecret(encrypt_legacy_using_IV('{"a":1}'))).toBe('{"a":1}');
      expect(AuthService.decryptSecret(AuthService.encryptSecret('{"a":1}'))).toBe('{"a":1}');
    });

    it('issues API keys the admin can read back and requests can be matched on', () => {
      const { key, apiKey, apiKeyHash } = AuthService.newApiKey();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(apiKey).toMatch(/^enc2::/);
      expect(AuthService.apiKeyForDisplay(apiKey)).toBe(key);
      expect(apiKeyHash).toBe(AuthService.lookupHash(key));
      // A row from before the upgrade: the column held the key itself.
      const legacyKey = encrypt_legacy_using_IV('abc');
      expect(AuthService.apiKeyForDisplay(legacyKey)).toBe(legacyKey);
    });
  });
});
