import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// E2E-08-55/56: the published package, built as npm gets it. `import Postra
// from '@postra/node'` in plain Node ESM threw "Postra is not a constructor"
// (CJS-only build), and the README example did not compile in strict
// TypeScript (fields the API treats as optional were required in the types).
const sdk = join(__dirname, '..');
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

describe('@postra/node as published', () => {
  const app = mkdtempSync(join(tmpdir(), 'postra-sdk-'));
  const pkg = join(app, 'node_modules', '@postra', 'node');

  beforeAll(() => {
    run('npx', ['tsup', '--out-dir', join(app, 'built')], sdk);
    mkdirSync(pkg, { recursive: true });
    cpSync(join(app, 'built'), join(pkg, 'dist'), { recursive: true });
    cpSync(join(sdk, 'package.json'), join(pkg, 'package.json'));
  }, 120_000);

  it('works with a default import in plain Node ESM', () => {
    writeFileSync(
      join(app, 'esm.mjs'),
      "import Postra, { PostraError } from '@postra/node';\nconst p = new Postra('k');\nconsole.log(typeof p.integrations, typeof PostraError);\n"
    );
    expect(run('node', ['esm.mjs'], app).trim()).toBe('function function');
  });

  it('still works with require()', () => {
    writeFileSync(
      join(app, 'cjs.cjs'),
      "const sdk = require('@postra/node');\nconst Postra = sdk.default || sdk;\nconsole.log(typeof new Postra('k').post);\n"
    );
    expect(run('node', ['cjs.cjs'], app).trim()).toBe('function');
  });

  it('compiles the README example in strict TypeScript', () => {
    writeFileSync(
      join(app, 'example.ts'),
      `import Postra from '@postra/node';
const postra = new Postra('YOUR_API_KEY');
async function main() {
  await postra.post({
    type: 'schedule',
    date: '2026-11-02T09:00:00.000Z',
    shortLink: false,
    tags: [],
    posts: [{ integration: { id: 'CHANNEL_ID' }, value: [{ content: '<p>Hello from Postra</p>', image: [] }] }],
  });
  await postra.postList({ startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-30T00:00:00.000Z' });
}
main();
`
    );
    expect(() =>
      run(
        join(sdk, '..', '..', 'node_modules', '.bin', 'tsc'),
        // A Node project has @types/node (Buffer in upload()); borrow the repo's.
        ['--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--typeRoots', join(sdk, '..', '..', 'node_modules', '@types'), '--types', 'node', 'example.ts'],
        app
      )
    ).not.toThrow();
  });
});
