import { readFileSync } from 'fs';
import { join } from 'path';

// A provider that talks to a server the customer names (their Lemmy
// instance, their Listmonk or WordPress server, their Bluesky PDS) must open
// every connection through instanceFetch, which refuses addresses inside our
// own network on every hop. Lemmy used the plain fetch, which follows a
// redirect anywhere; Listmonk had no check at all.
const source = (file: string) => readFileSync(join(__dirname, 'social', file), 'utf8');

describe('providers that connect to a server named by the customer', () => {
  it('Lemmy calls no plain fetch', () => {
    const code = source('lemmy.provider.ts');
    expect(code).toContain('instanceFetch(');
    expect(code).not.toMatch(/(?<![\w.])fetch\(/);
  });

  it.each(['listmonk.provider.ts', 'wordpress.provider.ts'])(
    '%s sends its requests through instanceFetch',
    (file) => {
      const code = source(file);
      expect(code).toMatch(/httpFetch = instanceFetch/);
      expect(code).not.toMatch(/(?<![\w.])fetch\(/);
    }
  );
});
