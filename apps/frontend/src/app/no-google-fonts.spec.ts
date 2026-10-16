import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// next/font/google downloads the font from Google during the build, so a
// Google hiccup fails the build (upstream ea9c82016; our CI notes record
// "flaky fonts"). Postra's font is Geist, served from the geist package.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path);
    return /\.(tsx?|jsx?)$/.test(name) && !/\.spec\./.test(name) ? [path] : [];
  });

describe('fonts', () => {
  it('nothing in the frontend loads fonts from Google at build time', () => {
    const offenders = files(join(__dirname, '..')).filter((f) =>
      readFileSync(f, 'utf8').includes('next/font/google')
    );
    expect(offenders).toEqual([]);
  });
});
