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

// Packages dependabot.yml ignores outright, not only their majors: the ones we
// cannot take yet (TypeScript, CopilotKit, @atproto/api, polotno). Their minors
// no longer come as PRs (K. 2026-10-17), so this issue is where they show.
const config = readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');
const npmEntry = config.split(/^\s*- package-ecosystem:/m)[1] || '';
const ignored = [...npmEntry.matchAll(/^\s*- dependency-name: "([^"*]+)"\s*\n\s*update-types: \[[^\]]*semver-minor[^\]]*\]/gm)].map((m) => m[1]);
const held = Object.entries(outdated)
  .filter(([name, v]) => ignored.includes(name) && v.current !== v.latest && major(v.latest) <= major(v.current))
  .map(([name, v]) => ({ name, ...v }))
  .sort((a, b) => a.name.localeCompare(b.name));

// pnpm itself (packageManager): Dependabot leaves it alone, it moves through
// its own program because a newer pnpm re-resolves peers in the lockfile.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const pnpmOurs = String(pkg.packageManager || '').replace(/^pnpm@/, '');
let pnpmLatest;
try {
  const res = await fetch('https://registry.npmjs.org/pnpm/latest');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  pnpmLatest = (await res.json()).version;
  if (!/^\d+\.\d+\.\d+$/.test(String(pnpmLatest))) throw new Error(`no version in the answer: ${pnpmLatest}`);
} catch (err) {
  console.error('Cannot read the latest pnpm: ' + err);
  process.exit(1);
}
const pnpmBehind = pnpmLatest && pnpmLatest !== pnpmOurs;

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
if (held.length) {
  lines.push(
    '',
    `${held.length} held back on purpose (ignored in dependabot.yml, each with its reason in the launch plan):`,
    '',
    '| Package | Ours | Latest | In |',
    '|---|---|---|---|',
    ...held.map((r) => `| \`${r.name}\` | ${r.current} | ${r.latest} | ${(r.dependentPackages || []).map((p) => p.name).join(', ')} |`)
  );
}
if (pnpmBehind) {
  lines.push('', `pnpm (packageManager) is ${pnpmOurs}, the latest is ${pnpmLatest}.`);
}
if (deprecated.length) {
  lines.push('', `Deprecated by their authors: ${deprecated.map((d) => `\`${d}\``).join(', ')}.`);
}
console.log(lines.join('\n'));
console.error(`MAJORS=${rows.length + held.length + (pnpmBehind ? 1 : 0)}`);
