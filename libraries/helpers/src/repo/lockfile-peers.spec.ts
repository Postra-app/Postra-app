import { readFileSync } from 'fs';
import { join } from 'path';

// mobx-react-lite had no mobx beside it in package.json, so every relock
// handed it the newest mobx (7) while polotno ships with 6: two MobX copies,
// and the design editor's observers would watch the wrong one. canvas was
// declared ^2 while konva wants ^3. Any `pnpm add` re-resolved those peers
// and dragged both changes into unrelated PRs (17 X). Each now has one
// version.

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
  it.each(['mobx', 'canvas'])('has one version of %s', (name) => {
    expect(versionsOf(name)).toHaveLength(1);
  });

  // One number for what the root and the frontend both declare: a copy in
  // each manifest would let a bump of one split the graph again (Codex 19 X).
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const catalog = Object.fromEntries(
    [...(workspace.split(/^catalog:\s*$/m)[1] ?? '').matchAll(/^  ([^\s:]+): (\S+)$/gm)].map(
      (m) => [m[1], m[2]]
    )
  );
  const shared = ['mobx', 'mobx-react-lite', 'polotno', 'typescript'];

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

  it('gives mobx-react-lite the mobx polotno uses', () => {
    expect(versionsOf('mobx')).toEqual([catalog.mobx]);
    const peers = [...lock.matchAll(/mobx-react-lite@[^\s:]*?\(mobx@([^)]+)\)/g)];
    expect(peers.length).toBeGreaterThan(0);
    for (const [, version] of peers) {
      expect(version).toBe(catalog.mobx);
    }
  });
});
