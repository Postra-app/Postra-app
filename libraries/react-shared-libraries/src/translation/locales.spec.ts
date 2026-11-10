import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { languages, parkedLanguages, defaultNS } from './i18n.config';

// i18next only loads the languages listed in i18n.config.ts. A catalogue
// without an entry there is dead weight nobody can reach (bn and ka_ge sat
// here unreachable with 694 and 505 keys); an entry without a
// catalogue fails to load at runtime. Keep the two lists the same.

const dir = join(__dirname, 'locales');

describe('translation catalogues', () => {
  it('are each either loaded or parked until complete', () => {
    expect(readdirSync(dir).sort()).toEqual(
      [...languages, ...parkedLanguages].sort()
    );
  });

  // A language goes live only complete: Polish fell 251 texts behind and a
  // Polish customer read Billing and Help half in English.
  it.each(languages.filter((l) => l !== 'en'))(
    '%s has every English text',
    (lang) => {
      const read = (l: string) =>
        JSON.parse(readFileSync(join(dir, l, `${defaultNS}.json`), 'utf8'));
      const en = read('en');
      const other = read(lang);
      expect(Object.keys(en).filter((k) => !(k in other))).toEqual([]);
    }
  );

  // A key the code asks for but no catalogue has renders its English
  // fallback in every language, and the check above cannot see it: "Are you
  // sure you want to revoke access" was English in Polish. The admin panel
  // (keys `admin_*`) is staff-only and written in English only.
  it('has every key the app asks for', () => {
    const en = JSON.parse(
      readFileSync(join(dir, 'en', `${defaultNS}.json`), 'utf8')
    );
    const roots = [
      join(__dirname, '../../../../apps/frontend/src'),
      join(__dirname, '..'),
    ];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const path = join(d, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'node_modules' && name !== 'locales') walk(path);
        } else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) {
          files.push(path);
        }
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(100);
    const missing = new Set<string>();
    for (const file of files) {
      for (const [, key] of readFileSync(file, 'utf8').matchAll(
        /\bt\(\s*['"]([a-z0-9_]+)['"]/g
      )) {
        if (!key.startsWith('admin_') && !(key in en)) missing.add(key);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it.each(languages)('%s has a catalogue', (lang) => {
    expect(existsSync(join(dir, lang, `${defaultNS}.json`))).toBe(true);
  });
});
