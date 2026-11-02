import { SENTRY_IGNORED_SPANS } from './initialize.sentry';
// Sentry's own matcher for `ignoreSpans` and its SQL span namer (neither is
// re-exported from a package root), so the test checks the filters exactly
// as the SDK names and matches spans. The packages' "exports" hide the
// files, so they are found next to the entry points.
import { dirname, join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { shouldIgnoreSpan } = require(
  join(dirname(require.resolve('@sentry/core')), 'utils/should-ignore-span.js')
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getSqlQuerySummary } = require(
  join(dirname(require.resolve('@sentry/server-utils')), 'utils/sql.js')
);

type Span = { description?: string; op?: string; attributes?: Record<string, unknown> };
const ignored = (span: Span) => shouldIgnoreSpan(span, SENTRY_IGNORED_SPANS);
// Sentry 11 names a database span by the summary of its SQL.
const db = (sql: string): Span => ({ description: getSqlQuerySummary(sql), op: 'db' });
const express = (name: string): Span => ({
  description: name,
  op: 'middleware',
  attributes: { 'sentry.origin': 'auto.http.express' },
});

describe('Sentry ignored spans', () => {
  it('drops Prisma internals, transaction bookkeeping and Express middleware', () => {
    expect(ignored({ description: 'prisma:engine:query' })).toBe(true);
    expect(ignored({ description: 'prisma:engine:connection' })).toBe(true);
    expect(ignored({ description: 'prisma:client:serialize' })).toBe(true);
    expect(ignored(db('BEGIN'))).toBe(true);
    expect(ignored(db('COMMIT'))).toBe(true);
    expect(ignored(db('DEALLOCATE ALL'))).toBe(true);
    expect(ignored(express('jsonParser'))).toBe(true);
  });

  it('keeps the spans that say where the time went', () => {
    expect(ignored({ description: 'prisma:client:operation' })).toBe(false);
    expect(ignored(db('SELECT "public"."Post".* FROM "public"."Post" WHERE 1=1'))).toBe(false);
    expect(ignored({ description: 'GET /posts', op: 'http.server' })).toBe(false);
    expect(ignored({ description: 'BEGIN', op: 'http.client' })).toBe(false);
    // Nest's own middleware spans say which guard or pipe took the time.
    expect(
      ignored({ description: 'AuthMiddleware', op: 'middleware', attributes: { 'sentry.origin': 'auto.middleware.nestjs' } })
    ).toBe(false);
  });
});
