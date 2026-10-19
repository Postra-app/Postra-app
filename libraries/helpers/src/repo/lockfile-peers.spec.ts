import { readFileSync } from 'fs';
import { join } from 'path';

// mobx-react-lite had no mobx beside it in package.json, so every relock
// handed it the newest mobx (7) while polotno ships with 6: two MobX copies,
// and the design editor's observers would watch the wrong one. canvas was
// declared ^2 while konva wants ^3. Any `pnpm add` re-resolved those peers
// and dragged both changes into unrelated PRs (17 X). Each now has one
// version, pinned in package.json.

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

  it('gives mobx-react-lite the mobx polotno uses', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(versionsOf('mobx')).toEqual([pkg.dependencies.mobx]);
    const peers = [...lock.matchAll(/mobx-react-lite@[^\s:]*?\(mobx@([^)]+)\)/g)];
    expect(peers.length).toBeGreaterThan(0);
    for (const [, version] of peers) {
      expect(version).toBe(pkg.dependencies.mobx);
    }
  });
});
