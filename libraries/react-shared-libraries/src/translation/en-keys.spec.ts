import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { join } from 'path';

// E2E-05-94 (9): hundreds of texts lived only as fallbacks in the code, so
// the English file was not the list of what customers read, and wording
// reviews missed them. Every t('key', 'text') with a plain text has its key
// in the English file; and English never says "modal" to a customer.
const root = join(__dirname, '../../../..');
const en: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, 'locales/en/translation.json'), 'utf8')
);

const used = () => {
  const keys = new Map<string, string>();
  const files = globSync(
    ['apps/frontend/src/**/*.{ts,tsx}', 'libraries/react-shared-libraries/src/**/*.{ts,tsx}'],
    { cwd: root, ignore: ['**/*.spec.*'] }
  );
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const m of source.matchAll(/\bt\(\s*'([a-z0-9_]+)'\s*,\s*'((?:\\.|[^'\\])*)'/g)) {
      if (!keys.has(m[1])) keys.set(m[1], file);
    }
  }
  return keys;
};

describe('English texts', () => {
  it('has every key the app uses with a plain text', () => {
    const missing = [...used()].filter(([key]) => !(key in en)).map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  it('does not call a window a "modal"', () => {
    expect(Object.entries(en).filter(([, text]) => /\bmodal\b/i.test(text))).toEqual([]);
  });
});
