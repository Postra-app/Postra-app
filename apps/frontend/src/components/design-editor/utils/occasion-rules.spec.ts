import { addDays, easterSunday, nthWeekday, toIso } from './occasion-rules';
import { getUkOccasions } from './uk-occasions';
import { getPolishOccasions } from './polish-occasions';
import { getUpcomingHolidays } from './holidays';

// The occasions in Studio's AI Generate panel ("In 6 days: Black Friday")
// are computed from rules, not typed in per year. A wrong rule shows a
// customer the wrong date for a sale, so the rules are checked against
// published dates for more than one year.

const dateOf = (list: { name: string; date: string }[], name: string, year: number) =>
  list.find((o) => o.name === name && o.date.startsWith(String(year)))?.date;

describe('occasion date rules', () => {
  it('Easter Sunday matches the published dates', () => {
    expect(toIso(easterSunday(2024))).toBe('2024-03-31');
    expect(toIso(easterSunday(2025))).toBe('2025-04-20');
    expect(toIso(easterSunday(2026))).toBe('2026-04-05');
    expect(toIso(easterSunday(2027))).toBe('2027-03-28');
    // The earliest and latest possible dates.
    expect(toIso(easterSunday(2285))).toBe('2285-03-22');
    expect(toIso(easterSunday(2038))).toBe('2038-04-25');
  });

  it('nthWeekday finds the 4th Thursday of November and the 1st Saturday of December', () => {
    expect(toIso(nthWeekday(2026, 11, 4, 4))).toBe('2026-11-26');
    expect(toIso(nthWeekday(2026, 12, 6, 1))).toBe('2026-12-05');
    // A month that starts on the weekday asked for.
    expect(toIso(nthWeekday(2026, 8, 6, 1))).toBe('2026-08-01');
  });

  it('addDays crosses a month and a year without a time-zone shift', () => {
    expect(toIso(addDays(new Date(2026, 11, 30), 3))).toBe('2027-01-02');
    expect(toIso(addDays(new Date(2026, 3, 5), -47))).toBe('2026-02-17');
  });
});

describe('Studio occasions on 21 November 2026', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 21, 18, 0, 0));
  });
  afterEach(() => jest.useRealTimers());

  it('the UK calendar has the UK dates, this year and next', () => {
    const uk = getUkOccasions();
    expect(dateOf(uk, 'Black Friday', 2026)).toBe('2026-11-27');
    expect(dateOf(uk, 'Cyber Monday', 2026)).toBe('2026-11-30');
    expect(dateOf(uk, 'Small Business Saturday (UK)', 2026)).toBe('2026-12-05');
    expect(dateOf(uk, 'Pancake Day', 2026)).toBe('2026-02-17');
    // Mothering Sunday, not the US/Polish Mother's Day.
    expect(dateOf(uk, "Mother's Day (UK)", 2026)).toBe('2026-03-15');
    expect(dateOf(uk, "Father's Day (UK)", 2026)).toBe('2026-06-21');
    expect(dateOf(uk, 'International Beer Day', 2026)).toBe('2026-08-07');

    expect(dateOf(uk, 'Black Friday', 2027)).toBe('2027-11-26');
    expect(dateOf(uk, 'Cyber Monday', 2027)).toBe('2027-11-29');
    expect(dateOf(uk, 'Small Business Saturday (UK)', 2027)).toBe('2027-12-04');
    expect(dateOf(uk, "Mother's Day (UK)", 2027)).toBe('2027-03-07');
    expect(dateOf(uk, 'Pancake Day', 2027)).toBe('2027-02-09');
    expect(uk.some((o) => o.date.startsWith('2028'))).toBe(false);
  });

  it('the Polish calendar keeps its own dates', () => {
    const pl = getPolishOccasions();
    expect(dateOf(pl, 'Fat Thursday', 2026)).toBe('2026-02-12');
    expect(dateOf(pl, "Mother's Day", 2026)).toBe('2026-05-26');
    expect(dateOf(pl, 'Black Friday', 2026)).toBe('2026-11-27');
  });

  it('the panel shows the next three occasions with the days to go', () => {
    const upcoming = getUpcomingHolidays(getUkOccasions(), 3);
    expect(upcoming.map((u) => [u.holiday.name, u.days])).toEqual([
      ['Black Friday', 6],
      ['Cyber Monday', 9],
      ['Small Business Saturday (UK)', 14],
    ]);
  });

  it('an occasion today counts as 0 days and one already past is left out', () => {
    jest.setSystemTime(new Date(2026, 10, 27, 23, 30, 0));
    const upcoming = getUpcomingHolidays(getUkOccasions(), 2);
    expect(upcoming.map((u) => [u.holiday.name, u.days])).toEqual([
      ['Black Friday', 0],
      ['Cyber Monday', 3],
    ]);
  });
});
