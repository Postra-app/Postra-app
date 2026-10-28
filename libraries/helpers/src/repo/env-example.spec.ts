import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// .env.example is how anyone running Postra learns its settings. It had
// drifted: 72 settings the code reads were missing (the database CA, the
// upload host, whole channels) and 5 listed ones were read by nothing.

const root = join(__dirname, '..', '..', '..', '..');

// Set by the runtime, the build or the tooling, never by whoever runs Postra.
const internal = new Set([
  'NODE_ENV',
  'NEXT_RUNTIME',
  'NEXT_PUBLIC_VERSION',
  'NEXT_PUBLIC_APP_VERSION',
  'GITHUB_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'TZ',
  'CI',
  'JEST_WORKER_ID',
]);
// Read by tools rather than by the code in apps/ and libraries/.
const tooling = new Set(['NX_ADD_PLUGINS']);

const readByCode = (): Set<string> => {
  const files = execSync('git ls-files apps libraries', { cwd: root })
    .toString()
    .split('\n')
    .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
    .filter((f) => !/\.(spec|test)\./.test(f));
  const keys = new Set<string>();
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g))
      keys.add(m[1]);
    for (const m of text.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g))
      keys.add(m[1]);
    for (const m of text.matchAll(/\{([^{}]+)\}\s*=\s*process\.env/g))
      for (const k of m[1].matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)) keys.add(k[1]);
  }
  return keys;
};

const listed = (): Set<string> =>
  new Set(
    [
      ...readFileSync(join(root, '.env.example'), 'utf8').matchAll(
        /^#? ?([A-Z][A-Z0-9_]+)=/gm
      ),
    ].map((m) => m[1])
  );

describe('.env.example', () => {
  const code = readByCode();
  const example = listed();

  it('lists every setting the code reads', () => {
    expect(code.size).toBeGreaterThan(100);
    expect(
      [...code].filter((k) => !example.has(k) && !internal.has(k)).sort()
    ).toEqual([]);
  });

  it('lists nothing the code does not read', () => {
    expect(
      [...example].filter((k) => !code.has(k) && !tooling.has(k)).sort()
    ).toEqual([]);
  });
});
