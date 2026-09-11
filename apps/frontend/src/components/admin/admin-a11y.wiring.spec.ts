import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Read as source rather than rendered: the admin components pull SWR, the user
// context and the modal manager, and jsdom does not start in this repo (its
// canvas binding is unbuilt). The claims below are structural, so the source is
// the right thing to assert against.
//
// Baseline from the audit: `grep "aria-\|role="` across the whole admin
// directory returned zero hits (E2E-09-56).

const ADMIN = join(__dirname);
const tabs = readdirSync(ADMIN).filter((f) => f.endsWith('.component.tsx'));
const read = (file: string) => readFileSync(join(ADMIN, file), 'utf8');

describe('every admin tab', () => {
  it('there are ten of them', () => {
    expect(tabs).toHaveLength(10);
  });

  it.each(tabs)('%s opens with a top-level heading', (file) => {
    expect(read(file)).toMatch(/<h1[\s>]/);
  });

  it.each(tabs)('%s uses no second-level heading as its title', (file) => {
    const source = read(file);
    const firstH1 = source.search(/<h1[\s>]/);
    const firstH2 = source.search(/<h2[\s>]/);
    if (firstH2 === -1) {
      return;
    }
    expect(firstH1).toBeLessThan(firstH2);
  });
});

// E2E-09-55: text at /30 measured 2.64:1 and /40 measured 3.80:1 against the
// panel background, both under the 4.5:1 floor — and they carried units, tiers
// and timestamps, which is content.
describe('contrast', () => {
  it.each(tabs)('%s has no body text below the AA floor', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/text-newTextColor\/(30|40)\b/);
  });
});

// E2E-09-12: the panel borrowed the product's generic keys — name, channels,
// posts, next, loading, from, to — which do have Polish entries, so a PL admin
// read "Nazwa | Tier | Period | Kanaly | Users | Posty | Created".
describe('translation keys', () => {
  const files = readdirSync(ADMIN).filter((f) => f.endsWith('.tsx'));

  it.each(files)('%s only uses admin-specific keys', (file) => {
    const keys = [...read(file).matchAll(/\bt\(\s*'([^']+)'/g)].map(
      (m) => m[1]
    );
    const borrowed = keys.filter((k) => !k.startsWith('admin_'));
    expect(borrowed).toEqual([]);
  });

  it('and no locale file translates one of them', () => {
    const localeDir = join(
      ADMIN,
      '../../../../../libraries/react-shared-libraries/src/translation/locales'
    );

    const adminKeys = new Set(
      files.flatMap((file) =>
        [...read(file).matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1])
      )
    );

    const translated: Record<string, string[]> = {};
    for (const lang of readdirSync(localeDir)) {
      const entries = JSON.parse(
        readFileSync(join(localeDir, lang, 'translation.json'), 'utf8')
      );
      const hit = Object.keys(entries).filter((k) => adminKeys.has(k));
      if (hit.length) {
        translated[lang] = hit;
      }
    }

    // The English fallback at the call site is the panel's only copy, by
    // decision. A locale entry would bring half-translated tables back.
    expect(translated).toEqual({});
  });
});
