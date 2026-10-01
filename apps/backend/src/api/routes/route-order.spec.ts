import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Nest matches routes in declaration order, so a literal route declared after
// a parameterised one with the same shape never runs: @Get('/:id') answers
// for it. It has bitten twice — /admin/errors/platforms, then
// /media/video-options, which every composer open called and which had never
// once reached its handler. This reads every controller and fails on any
// route that an earlier one shadows.

const ROOT = join(__dirname, '..', '..');

const controllers = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllers(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });

type Route = { method: string; path: string; line: number };

const routesOf = (file: string): Route[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((text, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(text)) return [];
      const match = /@(Get|Post|Put|Delete|Patch)\(\s*'([^']*)'/.exec(text);
      return match ? [{ method: match[1], path: match[2], line: i + 1 }] : [];
    });

const segments = (path: string) => path.split('/').filter(Boolean);

const shadows = (earlier: Route, later: Route) => {
  const a = segments(earlier.path);
  const b = segments(later.path);
  return (
    earlier.method === later.method &&
    earlier.path !== later.path &&
    a.length === b.length &&
    a.some((s) => s.startsWith(':')) &&
    a.every((s, i) => s.startsWith(':') || s === b[i])
  );
};

describe('controller route order', () => {
  it('declares no route that an earlier parameterised route swallows', () => {
    const problems: string[] = [];
    for (const file of controllers(ROOT)) {
      const routes = routesOf(file);
      routes.forEach((earlier, i) => {
        for (const later of routes.slice(i + 1)) {
          if (shadows(earlier, later)) {
            problems.push(
              `${relative(ROOT, file)}:${later.line} ${later.method} ${later.path} is swallowed by ${earlier.path} (line ${earlier.line})`
            );
          }
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('finds the case it exists for', () => {
    expect(
      shadows(
        { method: 'Get', path: '/:id', line: 1 },
        { method: 'Get', path: '/video-options', line: 2 }
      )
    ).toBe(true);
    expect(
      shadows(
        { method: 'Get', path: '/:id', line: 1 },
        { method: 'Get', path: '/generate-video/:type/allowed', line: 2 }
      )
    ).toBe(false);
  });
});
