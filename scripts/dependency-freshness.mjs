// Reads `pnpm outdated --format json` (a file path, or stdin) and prints the
// body of the weekly "majors behind" issue. Dependabot proposes minors and
// patches; majors each need work of their own, so this list is their guard
// (.github/workflows/dependency-freshness.yml).
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.argv[2] || 0, 'utf8');
// pnpm prints warnings before the JSON (an engine mismatch, for one).
const start = raw.search(/^\{/m);
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
  '| Package | Ours | Latest | Type |',
  '|---|---|---|---|',
  ...rows.map((r) => `| \`${r.name}\` | ${r.current} | ${r.latest} | ${r.dependencyType || ''} |`),
];
if (deprecated.length) {
  lines.push('', `Deprecated by their authors: ${deprecated.map((d) => `\`${d}\``).join(', ')}.`);
}
console.log(lines.join('\n'));
console.error(`MAJORS=${rows.length}`);
