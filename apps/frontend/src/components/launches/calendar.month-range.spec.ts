jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => jest.fn() }));

import { fetchRange } from './calendar.context';

// November 2026 draws 26 October - 6 December; only 1-30 November was asked
// for, so a post added on 3 December stayed invisible in that view.
describe('the month view loads every day it draws', () => {
  it('November 2026: from Monday 26 October to Sunday 6 December', () => {
    const { start, end } = fetchRange('month', '2026-11-01', '2026-11-30');
    expect(start.format('YYYY-MM-DD')).toBe('2026-10-26');
    expect(end.format('YYYY-MM-DD')).toBe('2026-12-06');
  });

  it('a month that starts on a Monday starts with it', () => {
    const { start, end } = fetchRange('month', '2027-02-01', '2027-02-28');
    expect(start.format('YYYY-MM-DD')).toBe('2027-02-01');
    expect(end.format('YYYY-MM-DD')).toBe('2027-03-14');
  });

  it('week and day views keep their own range', () => {
    const { start, end } = fetchRange('week', '2026-11-16', '2026-11-22');
    expect([start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')]).toEqual(['2026-11-16', '2026-11-22']);
  });
});
