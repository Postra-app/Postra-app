import { postingTimeOn, postingMinutesIn } from './posting.times';

// E2E-05-85: posting times were stored as minutes after UTC midnight, worked
// out from the browser's UTC offset on the day they were saved. A 09:00 slot
// saved in British Summer Time (480) fell at 08:00 once the clocks went back
// on 25 October 2026. A slot with a time zone keeps its wall-clock time.
describe('posting times', () => {
  const nine = { time: 9 * 60, tz: 'Europe/London' };

  it('a 09:00 London slot is 09:00 in London before and after the clocks go back', () => {
    expect(postingTimeOn(nine, '2026-10-24').toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(postingTimeOn(nine, '2026-10-26').toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(postingMinutesIn(nine, '2026-10-26', 'Europe/London')).toBe(9 * 60);
  });

  it('the day of the change keeps the wall-clock time', () => {
    expect(postingTimeOn(nine, '2026-10-25').toISOString()).toBe('2026-10-25T09:00:00.000Z');
    expect(postingTimeOn(nine, '2027-03-28').toISOString()).toBe('2027-03-28T08:00:00.000Z');
  });

  it('shows a slot of another zone at the viewer’s local time', () => {
    // 09:00 in London = 10:00 in Warsaw all year round
    expect(postingMinutesIn(nine, '2026-10-20', 'Europe/Warsaw')).toBe(10 * 60);
    expect(postingMinutesIn(nine, '2026-11-20', 'Europe/Warsaw')).toBe(10 * 60);
  });

  it('a slot without a zone is still minutes after UTC midnight', () => {
    expect(postingTimeOn({ time: 480 }, '2026-10-26').toISOString()).toBe('2026-10-26T08:00:00.000Z');
    expect(postingMinutesIn({ time: 480 }, '2026-10-20', 'Europe/London')).toBe(9 * 60);
  });
});
