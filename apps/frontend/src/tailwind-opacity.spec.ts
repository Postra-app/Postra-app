import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Tailwind 3 generates a colour-opacity modifier (text-white/80) only for
// values on its opacity scale. Anything else — text-textColor/78,
// border-white/8 — produces no CSS and fails silently: the channel menu's
// items fell back to the body's grey on a dark panel. This fails on any
// modifier the scale does not have; add the value to tailwind.config.cjs
// (theme.extend.opacity) or use a scale step.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../tailwind.config.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const defaultTheme = require('tailwindcss/defaultTheme');

const scale = new Set(
  Object.keys({ ...defaultTheme.opacity, ...(config.theme?.extend?.opacity || {}) })
);

const ROOTS = [
  join(__dirname),
  join(__dirname, '..', '..', '..', 'libraries', 'react-shared-libraries', 'src'),
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.spec\./.test(name) ? [path] : [];
  });

// prefix-colour/NN, not followed by more digits, a dot or a closing bracket
// (arbitrary values like bg-white/[.5] are generated on demand).
const MODIFIER =
  /(?<![\w-])(?:[a-z-]+:)*(?:text|bg|border|ring|from|to|via|fill|stroke|placeholder|divide|outline|shadow|decoration|caret|accent)-([A-Za-z][\w-]*?)\/(\d{1,3})(?![\d\].%])/g;

describe('Tailwind colour opacity modifiers', () => {
  it('only uses values the opacity scale generates', () => {
    const unknown: string[] = [];
    for (const root of ROOTS) {
      for (const file of files(root)) {
        for (const match of readFileSync(file, 'utf8').matchAll(MODIFIER)) {
          if (!scale.has(match[2])) {
            unknown.push(`${relative(join(__dirname, '..', '..', '..'), file)}: ${match[0]}`);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});
