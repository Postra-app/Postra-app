import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// CI runs on one explicit Ubuntu image, the newest GitHub offers. Not
// "ubuntu-latest": that label moves on GitHub's schedule (24.04 → 26.04 from
// 2026-10-19), and Playwright 1.58 had no browsers for 26.04, so the deploy
// smoke would have broken on whatever day the runner flipped. Moving is a
// PR that CI checks; runner-freshness.yml opens an issue when a newer image
// exists.
//
// Playwright installs in CI take their version from the root devDependency.
// Copies written into workflows did not follow upgrades.

const root = join(__dirname, '..', '..', '..', '..');
const dir = join(root, '.github', 'workflows');
const workflows = readdirSync(dir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
const scripts = [
  ...workflows,
  {
    name: 'scripts/deploy-staging.sh',
    text: readFileSync(
      join(root, '.github', 'scripts', 'deploy-staging.sh'),
      'utf8'
    ),
  },
];

const labels = workflows.flatMap(({ name, text }) =>
  [...text.matchAll(/^\s*runs-on:\s*'?([^'\s]+)'?\s*$/gm)].map((m) => ({
    name,
    label: m[1],
  }))
);

describe('CI workflows', () => {
  it('run on one explicit Ubuntu image', () => {
    expect(labels.length).toBeGreaterThan(0);
    for (const { name, label } of labels) {
      expect(`${name}: ${label}`).toMatch(/: ubuntu-\d\d\.04$/);
    }
    expect(new Set(labels.map((l) => l.label)).size).toBe(1);
  });

  it.each(scripts)(
    '$name installs Playwright at the root devDependency version',
    ({ text }) => {
      expect(text).not.toMatch(/@playwright\/test@\d/);
    }
  );

  // Same for the Prisma CLI: `pnpm dlx prisma@6.5.0` in the scripts, the boot
  // migration and CI kept running 6.5 after @prisma/client moved to 6.19.
  it.each([
    ...scripts,
    {
      name: 'package.json scripts',
      text: JSON.stringify(
        JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
      ),
    },
    {
      name: 'scripts/db-migrate.mjs',
      text: readFileSync(join(root, 'scripts', 'db-migrate.mjs'), 'utf8'),
    },
  ])('$name runs the Prisma CLI from one version source', ({ text }) => {
    expect(text).not.toMatch(/prisma@\d/);
  });

  // Node and pnpm come from package.json (volta.node, packageManager).
  // Copies in workflows went stale: CI built on 22.12.0 while production ran
  // 22.20, and isomorphic-dompurify 3.23 needs 22.22.2.
  it.each(workflows)(
    '$name takes Node and pnpm from package.json',
    ({ text }) => {
      expect(text).not.toMatch(/node-version:\s*['"]?\d/);
      expect(text).not.toMatch(/node-version:\s*\$\{\{\s*matrix/);
      expect(text).not.toMatch(
        /action-setup@[^\n]*\n\s+with:\n(\s+[a-z_-]+:[^\n]*\n)*?\s+version:/
      );
    }
  );

  it('builds the production image on the Node in volta.node', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const docker = readFileSync(join(root, 'Dockerfile.dev'), 'utf8');
    const version = pkg.volta.node.replace(/\./g, '\\.');
    expect(docker).toMatch(new RegExp(`^FROM node:${version}-`, 'm'));
  });
});
