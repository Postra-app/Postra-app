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
  // Eleven since the audit reader got a tab of its own: the trail was made
  // truthful in #227 and nothing read it (E2E-09-34).
  it('there are eleven of them', () => {
    expect(tabs).toHaveLength(11);
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

// E2E-09-60: the "Import Debug Post" modal gates its only action behind a
// channel picker that was a list of divs with onClick — no role, no tabIndex,
// no aria-checked. Measured in the live DOM on production: the whole modal
// offered two interactive elements, the close button and the disabled
// "Import as Draft", and the channel rows were neither. A keyboard user
// therefore reached a button that could never unlock.
describe('the debug-import channel picker', () => {
  const source = readFileSync(
    join(__dirname, '..', 'launches', 'import-debug-post.modal.tsx'),
    'utf8'
  );

  it('is a radio group, not a list of clickable divs', () => {
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('role="radio"');
    expect(source).toContain('aria-checked={selectedIntegrationId');
  });

  it('names the group for a screen reader', () => {
    expect(source).toContain('aria-labelledby="import-debug-integration-label"');
    expect(source).toContain('id="import-debug-integration-label"');
  });

  it('uses a real button, so it takes focus without a tabIndex', () => {
    const picker = source.slice(
      source.indexOf('role="radiogroup"'),
      source.indexOf('role="radiogroup"') + 900
    );
    expect(picker).toMatch(/<button/);
    expect(picker).not.toMatch(/<div[^>]*onClick/);
  });
});

// E2E-09-29 and E2E-09-55: the tier pill was defined twice, FREE fell through
// one copy to the error red, and the other put white text on a pastel fill at
// 2.64:1. There is one definition now, in admin-ui, and it is tested by
// calling it — see admin-ui.spec.ts. Asserting on source text is what let the
// first attempt pass with a FREE branch that could never run, so what remains
// here is only the claim that neither tab has grown its own copy back.
describe('the tier badge', () => {
  it('is not redefined inside a tab', () => {
    for (const file of ['admin-organizations.component.tsx', 'admin-subscriptions.component.tsx']) {
      const source = read(file);
      expect(source).toContain('tierBadgeClass');
      expect(source).not.toMatch(/const tierBadgeColors/);
      expect(source).not.toMatch(/rounded-full[^`'"]*text-white/);
    }
  });
});
