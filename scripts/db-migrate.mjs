#!/usr/bin/env node
/**
 * Boot-time database migration.
 *
 * Replaces `prisma db push`, which took production down twice (2026-07-08 and
 * again on the re-merge): db push refuses to apply anything it considers
 * data-loss (adding a unique index, tightening a column) without
 * --accept-data-loss, exits 1, and the container never starts. It also silently
 * reshapes the database to match the schema, so nobody reviews what runs
 * against production.
 *
 * `prisma migrate deploy` only applies reviewed migration files and never
 * invents DDL — but on a database that predates the migration history it would
 * try to replay the initial migration over existing tables and fail (P3009).
 * So this script baselines first, exactly once:
 *
 *   1. `_prisma_migrations` missing + application tables present  → mark every
 *      migration as already applied (the schema is already there), then deploy.
 *   2. `_prisma_migrations` missing + empty database (fresh env)  → deploy
 *      everything from scratch.
 *   3. `_prisma_migrations` present (normal boot)                  → deploy
 *      whatever is pending; a no-op when there is nothing new.
 *
 * Idempotent: safe to run on every boot, every replica.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = join(
  root,
  'libraries/nestjs-libraries/src/database/prisma/schema.prisma'
);
const migrationsDir = join(dirname(schema), 'migrations');

const prisma = (args, opts = {}) =>
  // The CLI from the lockfile, the same version as @prisma/client: a pinned
  // `pnpm dlx prisma@x` drifted from it and was fetched on every boot.
  execFileSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: root,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    env: process.env,
  });

/** True when the relation exists; false when the query errors (missing table). */
const probe = (relation) => {
  try {
    execFileSync(
      'pnpm',
      ['exec', 'prisma', 'db', 'execute', '--schema', schema, '--stdin'],
      {
        cwd: root,
        input: `SELECT 1 FROM "${relation}" LIMIT 1;`,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      }
    );
    return true;
  } catch {
    return false;
  }
};

const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

/** Squashed init only — additive migrations must run via `migrate deploy`. */
const BASELINE_MIGRATION = '00000000000000_init';

if (!migrations.length) {
  console.error('[db-migrate] no migrations found — refusing to boot');
  process.exit(1);
}

const hasMigrationsTable = probe('_prisma_migrations');
// "User" is the oldest table in the schema and exists in every environment that
// ever ran the app, so it is a reliable "this database is not empty" probe.
const hasApplicationTables = hasMigrationsTable ? true : probe('User');

if (!hasMigrationsTable && hasApplicationTables) {
  const toBaseline = migrations.filter((name) => name === BASELINE_MIGRATION);
  if (!toBaseline.length) {
    console.error(
      `[db-migrate] ${BASELINE_MIGRATION} missing — cannot baseline existing database`
    );
    process.exit(1);
  }
  console.log(
    `[db-migrate] existing database without migration history — baselining ${toBaseline.length} squash migration(s); ${migrations.length - toBaseline.length} additive migration(s) will deploy next`
  );
  for (const name of toBaseline) {
    prisma(['migrate', 'resolve', '--schema', schema, '--applied', name]);
  }
} else if (!hasMigrationsTable) {
  console.log('[db-migrate] empty database — applying migrations from scratch');
} else {
  console.log('[db-migrate] applying pending migrations (if any)');
}

prisma(['migrate', 'deploy', '--schema', schema]);
console.log('[db-migrate] database is up to date');
