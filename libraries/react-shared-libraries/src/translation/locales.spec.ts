import { existsSync, readdirSync, readFileSync } from 'fs';
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

  it.each(languages)('%s has a catalogue', (lang) => {
    expect(existsSync(join(dir, lang, `${defaultNS}.json`))).toBe(true);
  });
});
