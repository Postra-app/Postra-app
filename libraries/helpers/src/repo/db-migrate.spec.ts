import { spawnSync } from 'child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// scripts/db-migrate.mjs runs when a container starts, and a deploy starts
// two instances at once. Prisma lets one `migrate deploy` in at a time (an
// advisory lock) and the other gives up after 10 seconds; with a migration
// longer than that the second container exited and had to be started again.
// The script waits its turn instead; any other failure still stops the boot.

const root = join(__dirname, '..', '..', '..', '..');
const script = join(root, 'scripts', 'db-migrate.mjs');

const lockTimeout =
  'Error: P1002\n\nThe database server was reached but timed out.\n\n' +
  'Context: Timed out trying to acquire a postgres advisory lock ' +
  '(SELECT pg_advisory_lock(72707369)). Timeout: 10000ms.';

// A stand-in for `pnpm exec prisma`: the probes succeed, `migrate deploy`
// fails `failures` times with `message` and then succeeds.
function boot(failures: number, message: string) {
  const dir = mkdtempSync(join(tmpdir(), 'db-migrate-'));
  const calls = join(dir, 'calls');
  writeFileSync(calls, '');
  writeFileSync(join(dir, 'message'), message);
  const pnpm = join(dir, 'pnpm');
  writeFileSync(
    pnpm,
    [
      '#!/bin/sh',
      'case "$*" in',
      '  *"migrate deploy"*)',
      `    echo deploy >> "${calls}"`,
      `    if [ "$(wc -l < "${calls}")" -le ${failures} ]; then`,
      `      cat "${join(dir, 'message')}" >&2`,
      '      exit 1',
      '    fi',
      '    echo "All migrations have been successfully applied."',
      '    ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n')
  );
  chmodSync(pnpm, 0o755);
  const run = spawnSync('node', [script], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  const attempts = readFileSync(calls, 'utf8')
    .split('\n')
    .filter(Boolean).length;
  return { status: run.status, attempts, output: run.stdout + run.stderr };
}

describe('db-migrate', () => {
  it('applies migrations in one go when nothing else holds the lock', () => {
    const run = boot(0, '');
    expect(run.status).toBe(0);
    expect(run.attempts).toBe(1);
    expect(run.output).toContain(
      'All migrations have been successfully applied.'
    );
  });

  it('waits for another instance that is migrating instead of failing the boot', () => {
    const run = boot(2, lockTimeout);
    expect(run.status).toBe(0);
    expect(run.attempts).toBe(3);
  });

  it('stops the boot at once on a failed migration', () => {
    const run = boot(5, 'Error: P3018\n\nA migration failed to apply.');
    expect(run.status).toBe(1);
    expect(run.attempts).toBe(1);
    expect(run.output).toContain('P3018');
  });

  it('gives up when the lock never comes free', () => {
    const run = boot(1000, lockTimeout);
    expect(run.status).toBe(1);
    expect(run.attempts).toBe(30);
  });
});
