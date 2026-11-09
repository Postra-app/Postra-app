import { readFileSync } from 'fs';
import { join } from 'path';

// TypeScript 6 dropped baseUrl, so the path aliases in tsconfig.base.json are
// relative to the repository root. Nest CLI rewrites aliases in each app's
// output from the app's folder, so every Nest app's tsconfig.build.json holds
// the same aliases relative to that folder. If they drift, the build still
// type-checks but the built app requires "@gitroom/..." at run time and does
// not start.

const repo = join(__dirname, '..', '..', '..', '..');
// tsconfig files may hold comments.
const read = (path: string) =>
  JSON.parse(
    readFileSync(join(repo, path), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  ).compilerOptions;

const base: Record<string, string[]> = read('tsconfig.base.json').paths;

describe('Nest build path aliases', () => {
  it('has no baseUrl left in the base config', () => {
    expect(read('tsconfig.base.json').baseUrl).toBeUndefined();
  });

  for (const app of ['backend', 'orchestrator', 'commands']) {
    it(`${app} maps every alias of tsconfig.base.json, from its own folder`, () => {
      const own: Record<string, string[]> = read(`apps/${app}/tsconfig.build.json`).paths;
      const expected = Object.fromEntries(
        Object.entries(base).map(([alias, targets]) => [
          alias,
          targets.map((t) => `../../${t.replace(/^\.\//, '')}`),
        ])
      );
      expect(own).toEqual(expected);
    });
  }
});
