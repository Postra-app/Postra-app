import { dayEndingAt, percentageChangeFromSeries } from './analytics.utils';

describe('percentageChangeFromSeries', () => {
  it('returns 0 for empty, undefined, or single-point series (no baseline)', () => {
    expect(percentageChangeFromSeries(undefined)).toBe(0);
    expect(percentageChangeFromSeries([])).toBe(0);
    expect(percentageChangeFromSeries([{ total: 42 }])).toBe(0);
  });

  it('computes half-over-half growth', () => {
    // first half sum = 100, second half sum = 150 → +50%
    expect(
      percentageChangeFromSeries([{ total: 100 }, { total: 150 }])
    ).toBe(50);
  });

  it('computes decline as a negative number', () => {
    expect(
      percentageChangeFromSeries([{ total: 200 }, { total: 150 }])
    ).toBe(-25);
  });

  it('drops the middle point on odd-length series so halves are equal size', () => {
    // halves compared: [10] vs [30], middle 20 ignored → +200%
    expect(
      percentageChangeFromSeries([{ total: 10 }, { total: 20 }, { total: 30 }])
    ).toBe(200);
  });

  it('returns 100 when the baseline is zero but the period has activity', () => {
    expect(percentageChangeFromSeries([{ total: 0 }, { total: 5 }])).toBe(100);
  });

  it('returns 0 when both halves are zero', () => {
    expect(percentageChangeFromSeries([{ total: 0 }, { total: 0 }])).toBe(0);
  });

  it('coerces string totals (X returns stringified numbers)', () => {
    expect(
      percentageChangeFromSeries([
        { total: '100' } as any,
        { total: '120' } as any,
      ])
    ).toBe(20);
  });

  it('rounds to one decimal place', () => {
    // 100 → 133 = +33% exactly; 100 → 133.4 rounds
    expect(
      percentageChangeFromSeries([{ total: 300 }, { total: 400 }])
    ).toBe(33.3);
  });
});

describe('dayEndingAt', () => {
  it('names the day a Facebook daily value is for, not the moment its window closes', () => {
    // The value for 23 November arrives stamped with the next morning (UTC).
    expect(dayEndingAt('2026-11-24T08:00:00+0000')).toBe('2026-11-23');
    // Pacific daylight time: the window closes an hour earlier in UTC.
    expect(dayEndingAt('2026-07-01T07:00:00+0000')).toBe('2026-06-30');
    expect(dayEndingAt('2026-03-01T08:00:00+0000')).toBe('2026-02-28');
  });
});
