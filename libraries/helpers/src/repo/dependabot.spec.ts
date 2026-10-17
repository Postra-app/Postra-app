import { readFileSync } from 'fs';
import { join } from 'path';

// Dependabot gives a package to a group by dependency type before a group by
// wildcard pattern. On 2026-10-07 every @temporalio/* and @copilotkit/*
// package landed in "production" and the "ai" and "temporal" groups did
// nothing for them. The type groups have to exclude every pattern of the
// named groups, and this keeps those lists in step.

const root = join(__dirname, '..', '..', '..', '..');
const config = readFileSync(join(root, '.github', 'dependabot.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

type Group = {
  name: string;
  dependencyType?: string;
  patterns: string[];
  exclude: string[];
};

// The npm entry only: groups sit at six spaces, their keys at eight, and
// every list is written on one line.
const npm = config.split(/^\s*- package-ecosystem:/m)[1];
const groups: Group[] = [];
for (const line of npm.split('\n')) {
  const group = line.match(/^ {6}([\w-]+):\s*$/);
  if (group) {
    groups.push({ name: group[1], patterns: [], exclude: [] });
    continue;
  }
  const current = groups[groups.length - 1];
  const key = line.match(/^ {8}([\w-]+):\s*(.+)$/);
  if (!current || !key) continue;
  const list = () => JSON.parse(key[2]) as string[];
  if (key[1] === 'patterns') current.patterns = list();
  if (key[1] === 'exclude-patterns') current.exclude = list();
  if (key[1] === 'dependency-type') current.dependencyType = JSON.parse(key[2]);
}

const byType = groups.filter((g) => g.dependencyType);
const byPattern = groups.filter((g) => !g.dependencyType);
const matches = (pattern: string, name: string) =>
  new RegExp(
    '^' +
      pattern.replace(/[.+?^${}()|[\]\\/]/g, '\\$&').replace(/\*/g, '.*') +
      '$'
  ).test(name);

describe('Dependabot groups', () => {
  it('reads the npm groups', () => {
    expect(byType.map((g) => g.name)).toEqual(['production', 'development']);
    expect(byPattern.length).toBeGreaterThan(0);
  });

  it.each(byType)(
    '$name excludes exactly the patterns of the named groups',
    ({ exclude }) => {
      // An extra entry is a package no group updates at all (axe-core stayed
      // excluded after it left the held group).
      const patterns = byPattern.flatMap((g) => g.patterns);
      expect([...exclude].sort()).toEqual([...patterns].sort());
    }
  );

  it('puts each dependency in at most one named group', () => {
    const doubled = deps.filter(
      (name) =>
        byPattern.filter((g) => g.patterns.some((p) => matches(p, name)))
          .length > 1
    );
    expect(doubled).toEqual([]);
  });

  // Packages we cannot take yet are ignored outright; a "held" group opened a
  // red PR every week instead (#371, #386). The freshness issue lists them.
  it('holds back only packages the repo depends on, with no PR of their own', () => {
    const held = [
      ...npm.matchAll(/^\s*- dependency-name: "([^"*]+)"\s*\n\s*update-types: \[([^\]]*)\]/gm),
    ]
      .filter((m) => m[2].includes('semver-minor'))
      .map((m) => m[1]);
    expect(held.length).toBeGreaterThan(0);
    expect(held.filter((name) => !deps.includes(name))).toEqual([]);
    expect(groups.map((g) => g.name)).not.toContain('held');
    const guard = readFileSync(join(root, 'scripts', 'dependency-freshness.mjs'), 'utf8');
    expect(guard).toContain('dependabot.yml');
  });

  // An ignore without update-types also stops security updates (Codex,
  // 2026-10-17); naming the version-update types keeps them coming.
  it('never ignores security updates', () => {
    const entries = config.split(/^\s*- dependency-name:/m).slice(1);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.split('\n')[1] || '').toMatch(/^\s*update-types: \["version-update:/);
    }
  });

  // K. 2026-10-17: weekly runs gave too many bump PRs for no gain. Security
  // updates are not version updates and still come at once.
  it('runs version updates monthly', () => {
    const intervals = [...config.matchAll(/^\s*interval:\s*"(\w+)"/gm)].map((m) => m[1]);
    expect(intervals.length).toBeGreaterThan(0);
    expect(intervals.filter((i) => i !== 'monthly')).toEqual([]);
  });

  // Majors one by one ran Dependabot past its 55-minute limit (E2E-01-28).
  // They are ignored for version updates only, and a weekly workflow lists
  // them in an issue, so they still have a guard.
  it('leaves majors to the weekly freshness issue', () => {
    expect(npm).toMatch(
      /ignore:\n\s+- dependency-name: "\*"\n\s+update-types: \["version-update:semver-major"\]/
    );
    const guard = readFileSync(
      join(root, '.github', 'workflows', 'dependency-freshness.yml'),
      'utf8'
    );
    expect(guard).toMatch(/schedule:/);
    expect(guard).toContain('node scripts/dependency-freshness.mjs');
  });

  // pgAdmin and RedisInsight ran on :latest in the dev compose, with nothing
  // saying when they moved. Exact tags, and Dependabot watches the compose
  // images like the Dockerfile's.
  it('pins every dev compose image and watches the compose files', () => {
    const compose = readFileSync(join(root, 'docker-compose.dev.yaml'), 'utf8');
    const images = [...compose.matchAll(/^\s*image:\s*(\S+)/gm)].map(
      (m) => m[1]
    );
    expect(images.length).toBeGreaterThan(0);
    expect(images.filter((image) => /:latest$|^[^:]+$/.test(image))).toEqual(
      []
    );
    expect(config).toMatch(/- package-ecosystem: "docker-compose"/);
  });
});
