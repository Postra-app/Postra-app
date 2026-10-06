import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { languages, defaultNS } from './i18n.config';

// i18next only loads the languages listed in i18n.config.ts. A catalogue
// without an entry there is dead weight nobody can reach (bn and ka_ge sat
// here unreachable with 694 and 505 keys, E2E-01-14); an entry without a
// catalogue fails to load at runtime. Keep the two lists the same.

const dir = join(__dirname, 'locales');

describe('translation catalogues', () => {
  it('match the languages i18next loads', () => {
    expect(readdirSync(dir).sort()).toEqual([...languages].sort());
  });

  it.each(languages)('%s has a catalogue', (lang) => {
    expect(existsSync(join(dir, lang, `${defaultNS}.json`))).toBe(true);
  });
});
