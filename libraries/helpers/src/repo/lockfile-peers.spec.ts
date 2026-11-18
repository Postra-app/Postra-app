import { readFileSync } from 'fs';
import { join } from 'path';

// canvas was declared ^2 while konva wants ^3: any `pnpm add` re-resolved the
// peer and dragged the change into unrelated PRs. It now has one version.

const root = join(__dirname, '..', '..', '..', '..');
const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
const packages = lock.slice(
  lock.indexOf('\npackages:'),
  lock.indexOf('\nsnapshots:')
);

const versionsOf = (name: string) =>
  [...packages.matchAll(new RegExp(`\\n  '?${name}@([^:(']+)'?:`, 'g'))].map(
    (m) => m[1]
  );

describe('pnpm-lock.yaml peers', () => {
  it.each(['canvas'])('has one version of %s', (name) => {
    expect(versionsOf(name)).toHaveLength(1);
  });

  // One number for what the root and the frontend both declare: a copy in
  // each manifest would let a bump of one split the graph again.
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const catalog = Object.fromEntries(
    [...(workspace.split(/^catalog:\s*$/m)[1] ?? '').matchAll(/^  ([^\s:]+): (\S+)$/gm)].map(
      (m) => [m[1], m[2]]
    )
  );
  const shared = ['typescript'];

  it.each(['package.json', join('apps', 'frontend', 'package.json')])(
    '%s takes the shared editor versions from the catalog',
    (file) => {
      const pkg = JSON.parse(readFileSync(join(root, file), 'utf8'));
      const declared = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const name of shared) {
        expect(catalog[name]).toMatch(/^\d/);
        expect([name, declared[name]]).toEqual([name, 'catalog:']);
      }
    }
  );

  // Polotno is free only for non-commercial products, and its code shipped in
  // the front end's chunks although no key ever switched the editor on. Studio
  // is the editor; nothing that needs a paid licence goes back in.
  it.each(['polotno', '@blueprintjs/core', 'mobx-react-lite'])(
    'has no %s',
    (name) => {
      expect(versionsOf(name)).toEqual([]);
    }
  );
});
