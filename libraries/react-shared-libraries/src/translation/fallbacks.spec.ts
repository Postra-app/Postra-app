import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// t('key', 'English text') shows the English catalogue's entry when the key
// is there, so the text in the code is only a fallback. Fixes made to that
// text never reached anyone: Studio promised "5-10 seconds" for a month after
// the code said 30 (E2E-06-08), and account deletion never mentioned that
// the subscription is cancelled. The code and the catalogue have to agree.

const root = join(__dirname, '..', '..', '..', '..');
const en: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, 'locales', 'en', 'translation.json'), 'utf8')
);

const sources: string[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', 'dist'].includes(entry.name)) walk(path);
    } else if (/\.[jt]sx?$/.test(entry.name) && !/\.spec\./.test(entry.name)) {
      sources.push(path);
    }
  }
};
walk(join(root, 'apps', 'frontend', 'src'));
walk(join(root, 'libraries', 'react-shared-libraries', 'src'));

const call = /\bt\(\s*'([\w.-]+)'\s*,\s*(['"`])((?:\\.|(?!\2).)*?)\2\s*[,)]/gs;
const norm = (s: string) =>
  s
    .replace(/\\(['"`])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

const mismatches: string[] = [];
// E2E-05-94 (9): hundreds of texts lived only as fallbacks in the code, so
// the catalogue was not the list of what customers read and wording reviews
// missed them.
const missing: string[] = [];
let calls = 0;
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(call)) {
    const [, key, quote, fallback] = m;
    const line = text.slice(0, m.index).split('\n').length;
    const lineText = text.split('\n')[line - 1].trim();
    if (lineText.startsWith('//') || lineText.startsWith('*')) continue;
    if (quote === '`' && fallback.includes('${')) continue;
    calls++;
    // The admin panel is English only and keeps its keys out of every
    // locale file on purpose (E2E-09-12, admin-a11y.wiring.spec.ts).
    if (!(key in en) && !key.startsWith('admin_')) {
      missing.push(`${file.slice(root.length + 1)}:${line} ${key}`);
    }
    if (key in en && norm(en[key]) !== norm(fallback)) {
      mismatches.push(
        `${file.slice(root.length + 1)}:${line} ${key}: code "${norm(
          fallback
        )}" / en "${norm(en[key])}"`
      );
    }
  }
}

describe('English fallbacks', () => {
  it('finds the t() calls', () => {
    expect(calls).toBeGreaterThan(1000);
  });

  it('match the English catalogue', () => {
    expect(mismatches).toEqual([]);
  });

  it('all have their key in the English catalogue', () => {
    expect(missing).toEqual([]);
  });

  it('never call a window a "modal"', () => {
    expect(
      Object.entries(en).filter(([, text]) => /\bmodal\b/i.test(text))
    ).toEqual([]);
  });
});
