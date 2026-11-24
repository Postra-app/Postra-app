import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// Audit rows name people by id. A copy of someone's email address in a row
// outlives their account (rows are kept for over a year), which is not what
// "your account and its data have been deleted" says. One row may carry an
// address: a failed sign-in, which has no account to name, and that address
// is removed when the account it belongs to is deleted.
const root = join(__dirname, '..', '..', '..', '..');
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });

// Each `.record({ ... })` call of the audit service, cut at its closing brace.
const auditCalls = (code: string) => {
  const calls: string[] = [];
  const start = /[aA]udit(Service)?\s*\.record\(\{/g;
  for (let m = start.exec(code); m; m = start.exec(code)) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < code.length; end++) {
      if (code[end] === '{') depth++;
      if (code[end] === '}' && --depth === 0) break;
    }
    calls.push(code.slice(m.index, end + 1));
  }
  return calls;
};

it('no audit row except a failed sign-in is written with an email address', () => {
  const calls = [join(root, 'apps'), join(root, 'libraries')]
    .flatMap(sources)
    .flatMap((file) => auditCalls(readFileSync(file, 'utf8')).map((call) => ({ file, call })));
  expect(calls.length).toBeGreaterThan(20);
  const withAddress = calls
    .filter(({ call }) => /\bemail\b/.test(call.replace(/\/\/.*$/gm, '')))
    .map(({ file, call }) => `${file.slice(root.length + 1)}: ${call.match(/action:\s*([^,]+),/)?.[1]?.trim()}`);
  expect(withAddress).toEqual(["apps/backend/src/api/routes/auth.controller.ts: 'auth.login.failed'"]);
});
