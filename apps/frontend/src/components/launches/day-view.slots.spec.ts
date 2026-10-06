import { minutesInZone, postingMinutesInZone, slotDate } from './day-view.slots';

// E2E-05-61: Europe/Warsaw, a post on 6 October 2026 at 00:30 did not show in
// that day's view — its row came out as 7 October, 00:30.
describe('day view rows in the user time zone', () => {
  const tz = 'Europe/Warsaw';

  it('a post just after local midnight sits in that day at 00:30', () => {
    const publishDate = '2026-10-05T22:30:00.000Z'; // 00:30 in Warsaw
    const minutes = minutesInZone(publishDate, tz);
    expect(minutes).toBe(30);
    expect(slotDate('2026-10-06', minutes, tz).format('YYYY-MM-DD HH:mm')).toBe(
      '2026-10-06 00:30'
    );
    expect(slotDate('2026-10-06', minutes, tz).toISOString()).toBe(publishDate);
  });

  it('posting times stored in UTC minutes are shown at local time', () => {
    // 07:00 UTC = 09:00 in Warsaw (summer time)
    expect(postingMinutesInZone(7 * 60, '2026-10-06', tz)).toBe(9 * 60);
    // and 08:00 in winter
    expect(postingMinutesInZone(7 * 60, '2026-11-06', tz)).toBe(8 * 60);
  });

  it('rows after a clock change keep their wall-clock time', () => {
    // 25 October 2026: clocks go back at 03:00 in Warsaw.
    expect(slotDate('2026-10-25', 10 * 60, tz).format('HH:mm')).toBe('10:00');
    expect(slotDate('2026-10-25', 10 * 60, tz).toISOString()).toBe(
      '2026-10-25T09:00:00.000Z'
    );
  });
});
