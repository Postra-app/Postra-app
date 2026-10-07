// Reads `pnpm outdated -r --format json` (a file path, or stdin) and prints the
// body of the weekly "majors behind" issue. Dependabot proposes minors and
// patches; majors each need work of their own, so this list is their guard
// (.github/workflows/dependency-freshness.yml).
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.argv[2] || 0, 'utf8');
// pnpm prints warnings before the JSON (an engine mismatch, for one). No
// JSON is a clean result only when pnpm itself said so (exit 0); an error
// must not read as "nothing behind" and close the issue.
const start = raw.search(/^\{/m);
if (start < 0 && process.env.PNPM_OUTDATED_EXIT !== '0') {
  console.error('pnpm outdated gave no JSON:\n' + raw.slice(0, 2000));
  process.exit(1);
}
const outdated = start < 0 ? {} : JSON.parse(raw.slice(start));

const major = (v) => Number(String(v || '').replace(/^[^0-9]*/, '').split('.')[0]);
const rows = Object.entries(outdated)
  .filter(([, v]) => major(v.latest) > major(v.current))
  .map(([name, v]) => ({ name, ...v }))
  .sort((a, b) => a.name.localeCompare(b.name));
const deprecated = Object.entries(outdated)
  .filter(([, v]) => v.isDeprecated)
  .map(([name]) => name)
  .sort();

const lines = [
  `${rows.length} direct dependencies are a major version behind.`,
  '',
  'Each one is its own change with its own proof (CI and the stack tests, a real run where the package talks to an outside service). Dependabot skips majors on purpose: one week of checking them one by one ran past its 55-minute limit (e2e/bugs.md E2E-01-28).',
  '',
  '| Package | Ours | Latest | Type | In |',
  '|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| \`${r.name}\` | ${r.current} | ${r.latest} | ${r.dependencyType || ''} | ${(r.dependentPackages || []).map((p) => p.name).join(', ')} |`
  ),
];
if (deprecated.length) {
  lines.push('', `Deprecated by their authors: ${deprecated.map((d) => `\`${d}\``).join(', ')}.`);
}
console.log(lines.join('\n'));
console.error(`MAJORS=${rows.length}`);
