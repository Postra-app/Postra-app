import { readFileSync } from 'fs';
import { join } from 'path';

// Without a memory limit each Jest worker keeps every module it has loaded:
// three workers reached 14.9 GB together and the 16 GB CI runner stalled, so
// build-test ran into its 30 min limit with no log (twice on 2026-11-22).
// The limit has to stay in the config that both CI and local runs read.

const root = join(__dirname, '..', '..', '..', '..');

describe('Jest workers', () => {
  it('are replaced once they pass a memory limit', () => {
    const config = readFileSync(join(root, 'jest.config.ts'), 'utf8');
    const limit = config.match(/^\s*workerIdleMemoryLimit:\s*'(\d+)GB',/m);
    expect(limit).not.toBeNull();
    // Three workers at the limit, plus the main process, must leave room on
    // a 16 GB runner.
    expect(Number(limit![1])).toBeLessThanOrEqual(2);
  });

  it('run the same way in CI as locally: no worker count forced in the test script', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).not.toMatch(
      /workerIdleMemoryLimit|maxWorkers|runInBand/
    );
  });
});
