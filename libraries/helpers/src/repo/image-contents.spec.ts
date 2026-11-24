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

  // The base image is a snapshot of Debian from the day it was built. Without
  // an upgrade the image shipped zlib and glibc older than the security
  // updates Debian had already published.
  it("takes Debian's published updates before installing anything", () => {
    const first = dockerfile.indexOf('apt-get');
    const firstRun = dockerfile.slice(first, dockerfile.indexOf('rm -rf /var/lib/apt/lists', first));
    expect(firstRun).toMatch(/^apt-get update && apt-get upgrade -y/);
    expect(firstRun.indexOf('apt-get upgrade')).toBeLessThan(firstRun.indexOf('apt-get install'));
  });

  it('builds on the current Debian stable (trixie), not Debian 12', () => {
    // Every system package (ffmpeg, glibc, libtiff, sqlite) comes from the
    // base image's Debian release. Node images name it in the tag:
    // node:<version>-<codename>-slim. The weekly runner-freshness workflow
    // opens an issue when Debian stable is newer than this.
    const from = instructions.filter(({ line }) => line.startsWith('FROM '));
    // Two stages on the same base: the ffmpeg build and the image itself, so
    // the libraries ffmpeg was linked against are the ones it runs with.
    expect(from).toHaveLength(2);
    expect(from[0].line).toMatch(/^FROM node:\d+\.\d+\.\d+-trixie-slim AS ffmpeg$/);
    expect(from[1].line).toMatch(/^FROM node:\d+\.\d+\.\d+-trixie-slim$/);
    expect(from[0].line.replace(' AS ffmpeg', '')).toBe(from[1].line);
  });

  // Debian's ffmpeg package brought librsvg, gdk-pixbuf and libtiff with it:
  // a critical finding in the registry scan that Debian stable had no fix
  // for. The image builds FFmpeg's own release with what the app uses.
  it("has its own ffmpeg, not Debian's package with its two hundred libraries", () => {
    const installs = runLines
      .filter(({ line }) => line.includes('apt-get install'))
      .map(({ line }) => line);
    for (const line of installs) {
      expect(line).not.toMatch(/\sffmpeg(\s|$)/);
      expect(line).not.toMatch(/libtiff|librsvg|gdk-pixbuf/);
    }
    expect(dockerfile).toContain(
      'COPY --from=ffmpeg /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /usr/local/bin/'
    );
    expect(dockerfile).toContain('--disable-autodetect');
  });

  it('takes the ffmpeg source by version and checksum, and checks its signature', () => {
    expect(dockerfile).toMatch(/^ARG FFMPEG_VERSION=\d+\.\d+(\.\d+)?$/m);
    expect(dockerfile).toMatch(/^ARG FFMPEG_SHA256=[0-9a-f]{64}$/m);
    expect(dockerfile).toContain('sha256sum -c -');
    expect(dockerfile).toContain('grep -q "VALIDSIG ${FFMPEG_SIGNER}"');
    // The build fails here if the image lost what the app asks ffmpeg for:
    // captions burned in, MP3 for transcription, a frame read over HTTPS.
    for (const needed of ["' subtitles '", 'libx264', 'libmp3lame', 'https']) {
      expect(dockerfile).toContain(`grep -q ${needed}`);
    }
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
