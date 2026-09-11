import { HttpException } from '@nestjs/common';
import dayjs from 'dayjs';

/**
 * Query-parameter parsing for the admin endpoints.
 *
 * Five of them answered 500 to a bad parameter, because the raw string went
 * straight into Prisma. Measured on production: `?limit=abc` gave
 * `take: NaN` and a PrismaClientValidationError; `?page=-1` gave `skip: -20`,
 * which Prisma passes and Postgres rejects; `?from=garbage` sent an Invalid
 * Date into a filter and into a `$queryRaw` parameter slot, i.e. into the
 * database driver. `?limit=999999` on /admin/organizations returned the whole
 * table — every row with its subscription and three correlated counts — with
 * no rate limit in front of it, since /admin is deliberately outside the
 * throttler (E2E-09-36, -37, -38).
 *
 * The clamp already existed and was already right, in errors.repository; it is
 * shared here so the other handlers stop reinventing it badly.
 */

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

export interface Paging {
  page: number;
  limit: number;
  skip: number;
}

/**
 * A page of results. Out-of-range values are clamped rather than rejected: a
 * paging parameter is the panel's own doing, not something an operator typed,
 * and an empty page is a better answer than an error.
 *
 * `limit=0` used to slip through as a truthy string and return nothing.
 */
export const parsePaging = (
  page?: string,
  limit?: string,
  maxLimit = MAX_PAGE_SIZE
): Paging => {
  const parsedPage = Number.parseInt(page ?? '', 10);
  const parsedLimit = Number.parseInt(limit ?? '', 10);

  const safePage = Number.isFinite(parsedPage) ? Math.max(0, parsedPage) : 0;
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(1, parsedLimit), maxLimit)
    : Math.min(DEFAULT_PAGE_SIZE, maxLimit);

  return { page: safePage, limit: safeLimit, skip: safePage * safeLimit };
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date from a query string. Rejected rather than clamped: a range the
 * operator typed that we silently replace produces numbers they will read as
 * the ones they asked for.
 *
 * A plain day has to round-trip, because dayjs parses leniently — `2026-13-45`
 * is "valid" and rolls forward to 2027-02-14, which would answer a question
 * nobody asked with numbers that look authoritative.
 */
export const parseDay = (
  value: string | undefined,
  name: string
): dayjs.Dayjs | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = dayjs(value);
  const ok =
    parsed.isValid() &&
    (!ISO_DAY.test(value) || parsed.format('YYYY-MM-DD') === value);

  if (!ok) {
    throw new HttpException(`Invalid ${name} date: "${value}"`, 400);
  }

  return parsed;
};

/** A positive day count, or undefined. Anything unparseable is a 400. */
export const parseDayCount = (
  value: string | undefined,
  name: string
): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpException(`Invalid ${name}: "${value}"`, 400);
  }

  return parsed;
};
