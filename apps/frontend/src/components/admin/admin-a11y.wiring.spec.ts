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

  // Four of them had no heading element at all, and the rest mixed h1 with h2
  // (E2E-09-56). Every one opens with a heading now — an h2, because the app
  // shell's topbar already renders the page's h1 (its <Title/>), so a tab
  // adding its own h1 puts two on the page. Measured in the live DOM: with
  // tab headings as h1 the admin pages carried "Admin" and "Admin Stats" both
  // at level one.
  it.each(tabs)('%s opens with a heading', (file) => {
    expect(read(file)).toMatch(/<h2[\s>]/);
  });

  it.each(tabs)('%s leaves the h1 to the app shell', (file) => {
    expect(read(file)).not.toMatch(/<h1[\s>]/);
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

// E2E-09-29: FREE fell through the tier colour map to the error red, so
// perfectly ordinary accounts looked broken. The first attempt at this added a
// FREE branch that could never run: an org with no subscription row *is* FREE,
// and the missing-tier guard above it returned the error colour first.
// Measured in the live DOM before this fix: the FREE badge still rendered with
// a red-* class.
describe('the tier badge', () => {
  const source = read('admin-organizations.component.tsx');

  it('reads the tier through the same helper the label uses', () => {
    expect(source).toMatch(/const tierColor[\s\S]{0,200}?tierLabel\(sub\)/);
  });

  it('has no guard that can shadow the FREE branch', () => {
    const body = source.slice(
      source.indexOf('const tierColor'),
      source.indexOf('const tierColor') + 400
    );
    const freeAt = body.indexOf("=== 'FREE'");
    const guardAt = body.indexOf('if (!tier)');
    expect(freeAt).toBeGreaterThan(-1);
    expect(guardAt === -1 || freeAt < guardAt).toBe(true);
  });
});
