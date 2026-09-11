import {
  MAX_PAGE_SIZE,
  parseDay,
  parseDayCount,
  parsePaging,
} from '@gitroom/backend/api/routes/admin.query';

// Measured on production, all five 500s reached Sentry:
//   ?limit=abc  -> take: NaN         -> PrismaClientValidationError
//   ?page=-1    -> skip: -20         -> Postgres rejects OFFSET -20
//   ?from=garbage / ?days=abc -> Invalid Date into a Prisma filter and into a
//                                $queryRaw parameter slot
//   ?limit=999999 on /admin/organizations -> the whole table, unthrottled
// E2E-09-36, E2E-09-37, E2E-09-38.

describe('parsePaging', () => {
  it('defaults to the first page of twenty', () => {
    expect(parsePaging(undefined, undefined)).toEqual({
      page: 0,
      limit: 20,
      skip: 0,
    });
  });

  it('does not turn a non-numeric limit into NaN', () => {
    const { limit, skip } = parsePaging(undefined, 'abc');
    expect(Number.isFinite(limit)).toBe(true);
    expect(Number.isFinite(skip)).toBe(true);
    expect(limit).toBe(20);
  });

  it('never produces a negative offset', () => {
    expect(parsePaging('-1', '20').skip).toBe(0);
    expect(parsePaging('-99999', undefined).page).toBe(0);
  });

  it('caps the page size, so one request cannot ask for the whole table', () => {
    expect(parsePaging(undefined, '999999').limit).toBe(MAX_PAGE_SIZE);
    expect(parsePaging(undefined, String(MAX_PAGE_SIZE + 1)).limit).toBe(
      MAX_PAGE_SIZE
    );
  });

  it('treats a zero limit as one row, not as no rows', () => {
    expect(parsePaging(undefined, '0').limit).toBe(1);
  });

  it('offsets by whole pages', () => {
    expect(parsePaging('3', '25')).toEqual({ page: 3, limit: 25, skip: 75 });
  });

  it('honours a caller-supplied ceiling', () => {
    expect(parsePaging(undefined, '50', 10).limit).toBe(10);
  });
});

describe('parseDay', () => {
  it('accepts an ISO day', () => {
    expect(parseDay('2026-09-11', 'from')?.format('YYYY-MM-DD')).toBe(
      '2026-09-11'
    );
  });

  it('passes an absent value straight through', () => {
    expect(parseDay(undefined, 'from')).toBeUndefined();
    expect(parseDay('', 'from')).toBeUndefined();
  });

  it('answers 400 rather than sending Invalid Date to the database', () => {
    expect(() => parseDay('garbage', 'from')).toThrow(/Invalid from date/);
    expect(() => parseDay('2026-13-45', 'to')).toThrow(/Invalid to date/);
  });

  it('names the parameter it rejected', () => {
    try {
      parseDay('garbage', 'to');
      fail('should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(400);
      expect(e.message).toContain('to');
    }
  });
});

describe('parseDayCount', () => {
  it('accepts a plain count', () => {
    expect(parseDayCount('30', 'days')).toBe(30);
    expect(parseDayCount('0', 'days')).toBe(0);
  });

  it('passes an absent value straight through', () => {
    expect(parseDayCount(undefined, 'days')).toBeUndefined();
  });

  it('rejects what it cannot read', () => {
    expect(() => parseDayCount('abc', 'days')).toThrow(/Invalid days/);
    expect(() => parseDayCount('-5', 'days')).toThrow(/Invalid days/);
  });
});
