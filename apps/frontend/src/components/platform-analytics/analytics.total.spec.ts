import { analyticsTotal } from './analytics.total';

describe('analyticsTotal', () => {
  it('adds up counts', () => {
    expect(analyticsTotal({ data: [{ total: 3 }, { total: '4' }] })).toBe('7');
  });

  // Pinterest on prod: 1 click on 4 impressions read "1" (daily rates 0.5
  // and 0 added up and rounded); the channel now sends the period's rate.
  it('shows a rate for the period, not the sum of the daily rates', () => {
    expect(
      analyticsTotal({
        average: true,
        unit: 'percent',
        summary: 25,
        data: [{ total: 50 }, { total: 0 }],
      })
    ).toBe('25%');
  });

  it('shows seconds as a duration, not a percentage', () => {
    expect(
      analyticsTotal({ average: true, unit: 'seconds', summary: 95, data: [] })
    ).toBe('1m 35s');
    expect(
      analyticsTotal({
        average: true,
        unit: 'seconds',
        summary: 42.4,
        data: [],
      })
    ).toBe('42s');
  });

  it('keeps the mean of the days for an average without a summary', () => {
    expect(
      analyticsTotal({ average: true, data: [{ total: 1 }, { total: 2 }] })
    ).toBe('1.5%');
  });

  it('shows zero for a rate with no days', () => {
    expect(analyticsTotal({ unit: 'percent', data: [] })).toBe('0%');
  });
});
