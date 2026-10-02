import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { makeSecureId } from './make.secure.id';

describe('makeSecureId', () => {
  it('returns the requested length from the makeId alphabet', () => {
    for (const length of [6, 11, 32, 48, 500]) {
      expect(makeSecureId(length)).toMatch(new RegExp(`^[A-Za-z0-9]{${length}}$`));
    }
  });

  it('does not repeat across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => makeSecureId(16)));
    expect(ids.size).toBe(1000);
  });
});

// OAuth state and PKCE verifiers guard the channel-connect callback, so a
// provider must not go back to Math.random for them.
describe('social providers', () => {
  const dir = join(__dirname, '../integrations/social');
  const providers = readdirSync(dir).filter((f) => f.endsWith('.provider.ts'));

  it.each(providers)('%s generates state and verifiers with makeSecureId', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    expect(source).not.toMatch(/(state|[vV]erifier|nonce)\s*[:=]\s*makeId\(/);
    expect(source).not.toMatch(/(state|[vV]erifier)\s*[:=]\s*Math\.random/);
  });
});
