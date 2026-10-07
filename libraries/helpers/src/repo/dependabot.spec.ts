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
    '$name excludes every pattern of the named groups',
    ({ exclude }) => {
      const missing = byPattern
        .flatMap((g) => g.patterns)
        .filter((p) => !exclude.includes(p));
      expect(missing).toEqual([]);
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

  it('holds back only packages the repo depends on', () => {
    const held = byPattern.find((g) => g.name === 'held');
    expect(held?.patterns.filter((p) => !deps.includes(p))).toEqual([]);
  });
});
