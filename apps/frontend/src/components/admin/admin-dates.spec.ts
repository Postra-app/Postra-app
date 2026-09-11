import {
  axisLabel,
  formatDay,
  fullLabel,
  isoDaysAgo,
  isoLocal,
  startOfMonth,
  startOfWeek,
  today,
} from '@gitroom/frontend/components/admin/admin-dates';

// E2E-09-24: every Stats preset ended a day late, all summer. Dates were built
// with toISOString(), which reads the clock in UTC, and the header rendered the
// server's inclusive end-of-day back in local time.
// E2E-09-04: the twelve-month Growth axis read "22 23 24 25 26 27 28 14 15 26
// 28 9" — day numbers with no month and no year — because the label was a
// slice of the ISO string.

const atLocal = (iso: string) => {
  jest.useFakeTimers().setSystemTime(new Date(iso));
};

afterEach(() => {
  jest.useRealTimers();
});

describe('an ISO day built from the local calendar', () => {
  it('is the local date, not the UTC one', () => {
    // 00:30 BST on 11 September is 23:30 UTC on the 10th. toISOString would
    // have said the 10th.
    atLocal('2026-09-10T23:30:00Z');
    const local = new Date();
    expect(isoLocal(local)).toBe(
      `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(local.getDate()).padStart(2, '0')}`
    );
    expect(isoLocal(local)).toBe(today());
  });

  it('pads month and day to two digits', () => {
    expect(isoLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isoLocal(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('preset ranges', () => {
  it('makes "last 7 days" seven days, both ends inclusive', () => {
    atLocal('2026-09-11T12:00:00');
    const from = new Date(`${isoDaysAgo(6)}T00:00:00`);
    const to = new Date(`${today()}T00:00:00`);
    const span = Math.round((+to - +from) / 86_400_000) + 1;
    expect(span).toBe(7);
  });

  it('starts the week on Monday', () => {
    atLocal('2026-09-11T12:00:00'); // a Friday
    expect(new Date(`${startOfWeek()}T00:00:00`).getDay()).toBe(1);
  });

  it('starts the month on the first', () => {
    atLocal('2026-09-11T12:00:00');
    expect(startOfMonth().endsWith('-01')).toBe(true);
  });
});

describe('labels', () => {
  it('never renders a bare day number on a long range', () => {
    const label = axisLabel('2026-06-22', 365);
    expect(label).not.toBe('22');
    expect(label).toMatch(/jun/i);
    expect(label).toMatch(/26/);
  });

  it('keeps day and month on a short range', () => {
    const label = axisLabel('2026-06-22', 30);
    expect(label).toMatch(/22/);
    expect(label).toMatch(/jun/i);
  });

  it('always puts a year in the tooltip', () => {
    expect(fullLabel('2026-06-22')).toMatch(/2026/);
  });

  it('does not shift the day when formatting for the header', () => {
    expect(formatDay('2026-09-11')).toBe(
      new Date(2026, 8, 11).toLocaleDateString()
    );
  });

  it('passes through anything that is not a date', () => {
    // The old backend contract, in case a stale response ever arrives.
    expect(axisLabel('Mon Jun 22', 12)).toBe('Mon Jun 22');
    expect(fullLabel('')).toBe('');
    expect(formatDay('nonsense')).toBe('nonsense');
  });
});
