import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Every action is pinned to a commit, with the release it is in a comment for
// Dependabot. A tag can be moved to other code by whoever controls the
// action's repository (the Trivy action was, in 2026); a commit cannot. The
// repository also requires it (Actions setting sha_pinning_required).

const dir = join(__dirname, '..', '..', '..', '..', '.github', 'workflows');

describe('GitHub Actions in workflows', () => {
  const uses = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) =>
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .filter((line) => /^\s*-?\s*uses:\s/.test(line))
        .map((line) => `${f}: ${line.trim()}`)
    );

  it('finds the actions', () => {
    expect(uses.length).toBeGreaterThan(10);
  });

  it('are pinned to a full commit SHA with the release in a comment', () => {
    expect(
      uses.filter(
        (u) => !/uses:\s*\.\//.test(u) && !/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(u)
      )
    ).toEqual([]);
  });
});
