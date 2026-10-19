import { SENTRY_IGNORED_SPANS } from './initialize.sentry';
// Sentry's own matcher for `ignoreSpans` (not re-exported from the package
// root), so the test checks the filters exactly as the SDK applies them.
// The package's "exports" hide the file, so it is found next to the entry.
import { dirname, join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { shouldIgnoreSpan } = require(
  join(dirname(require.resolve('@sentry/core')), 'utils/should-ignore-span.js')
);

const ignored = (description: string, op?: string) =>
  shouldIgnoreSpan({ description, op }, SENTRY_IGNORED_SPANS);

describe('Sentry ignored spans', () => {
  it('drops Prisma internals, transaction bookkeeping and Express middleware', () => {
    expect(ignored('prisma:engine:query')).toBe(true);
    expect(ignored('prisma:engine:connection')).toBe(true);
    expect(ignored('prisma:client:serialize')).toBe(true);
    expect(ignored('BEGIN', 'db')).toBe(true);
    expect(ignored('COMMIT', 'db')).toBe(true);
    expect(ignored('jsonParser', 'middleware.express')).toBe(true);
  });

  it('keeps the spans that say where the time went', () => {
    expect(ignored('prisma:client:operation')).toBe(false);
    expect(ignored('SELECT "public"."Post".* FROM "public"."Post"', 'db')).toBe(false);
    expect(ignored('GET /posts', 'http.server')).toBe(false);
    expect(ignored('BEGIN', 'http.client')).toBe(false);
  });
});
