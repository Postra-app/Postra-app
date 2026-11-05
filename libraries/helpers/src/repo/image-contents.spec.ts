import { readFileSync } from 'fs';
import { join } from 'path';

// What ends up in the production image (Dockerfile.dev installs every
// dependency and runs from the same layer).
//
// - npm comes with the Node base image and bundles its own undici and
//   brace-expansion; nothing in the running container calls it, so it is
//   removed after the last step that needs it.
// - esbuild is a Go binary: an old release carries an old Go standard
//   library. Vite 6 kept esbuild 0.25 (Go 1.23) in the image through the
//   browser extension's build, long after the rest of the repo moved on.

const root = join(__dirname, '..', '..', '..', '..');
const dockerfile = readFileSync(join(root, 'Dockerfile.dev'), 'utf8');
const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');

// One entry per instruction: continuation lines joined.
const instructions = dockerfile
  .replace(/\\\n/g, ' ')
  .split('\n')
  .map((line, index) => ({ line: line.trim(), index }));
const runLines = instructions.filter(({ line }) => line.startsWith('RUN '));

describe('the production image', () => {
  it('removes npm and npx after the last step that uses them', () => {
    const removal = runLines.find(({ line }) =>
      /rm -rf \/usr\/local\/lib\/node_modules\/npm \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/.test(line)
    );
    expect(removal).toBeDefined();
    const users = runLines.filter(
      ({ line }) => /(^RUN |&& )(npm|npx|pm2 install)\b/.test(line) || /\bnpm --/.test(line)
    );
    expect(users.length).toBeGreaterThan(0);
    for (const use of users) {
      expect(use.index).toBeLessThan(removal!.index);
    }
    const cmd = instructions.find(({ line }) => line.startsWith('CMD '));
    expect(cmd).toBeDefined();
    expect(removal!.index).toBeLessThan(cmd!.index);
  });

  it('builds on the current Debian stable (trixie), not Debian 12', () => {
    // Every system package (ffmpeg, glibc, libtiff, sqlite) comes from the
    // base image's Debian release. Node images name it in the tag:
    // node:<version>-<codename>-slim. The weekly runner-freshness workflow
    // opens an issue when Debian stable is newer than this.
    const from = instructions.filter(({ line }) => line.startsWith('FROM '));
    expect(from).toHaveLength(1);
    expect(from[0].line).toMatch(/^FROM node:\d+\.\d+\.\d+-trixie-slim$/);
  });

  it('carries no esbuild older than 0.27 (an old Go standard library)', () => {
    const versions = [...lockfile.matchAll(/^ {2}esbuild@(\d+\.\d+\.\d+):$/gm)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    const old = versions.filter((v) => {
      const [major, minor] = v.split('.').map(Number);
      return major === 0 && minor < 27;
    });
    expect(old).toEqual([]);
  });
});
