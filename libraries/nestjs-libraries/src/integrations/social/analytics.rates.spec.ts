jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));

import 'reflect-metadata';
import { PinterestProvider } from './pinterest.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { ratePointChange, weightedAverage } from './analytics.utils';

// Rates are not counts. On prod (31 X) Pinterest "Pin click rate" read "1"
// for 1 click on 4 impressions and LinkedIn Page "Engagement" read "1.42":
// the card added up the daily rates. A channel now sends the period's rate
// (`summary`, in percent) and marks it as one.
const reply = (body: object) =>
  ({ ok: true, status: 200, json: async () => body } as any);

describe('analytics rates', () => {
  afterEach(() => jest.restoreAllMocks());

  it('weights the days by what the rate is taken over', () => {
    expect(
      weightedAverage(
        [
          { rate: 0.02, weight: 100 },
          { rate: 0.01, weight: 300 },
        ],
        100
      )
    ).toBe(1.25);
    expect(weightedAverage([{ rate: 0.5, weight: 0 }], 100)).toBe(0);
  });

  it('Pinterest: the click rate is clicks over impressions for the period', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue(
      reply({
        all: {
          daily_metrics: [
            {
              date: '2026-10-30',
              metrics: {
                PIN_CLICK_RATE: 0.5,
                IMPRESSION: 2,
                PIN_CLICK: 1,
                ENGAGEMENT: 1,
                SAVE: 0,
              },
            },
            {
              date: '2026-10-31',
              metrics: {
                PIN_CLICK_RATE: 0,
                IMPRESSION: 2,
                PIN_CLICK: 0,
                ENGAGEMENT: 0,
                SAVE: 0,
              },
            },
          ],
        },
      })
    );
    const [rate, impressions] = await new PinterestProvider().analytics(
      'u1',
      't',
      7
    );
    expect(rate).toMatchObject({
      label: 'Pin click rate',
      average: true,
      unit: 'percent',
      summary: 25,
    });
    expect(rate.data.map((d) => d.total)).toEqual([50, 0]);
    expect(impressions.unit).toBeUndefined();
  });

  it('LinkedIn Page: engagement is weighted by impressions, in percent', async () => {
    const day = (
      start: number,
      engagement: number,
      impressionCount: number
    ) => ({
      timeRange: { start, end: start + 86400000 },
      totalShareStatistics: {
        clickCount: 0,
        shareCount: 0,
        commentCount: 0,
        engagement,
        impressionCount,
      },
    });
    jest
      .spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce(reply({ elements: [] }))
      .mockResolvedValueOnce(reply({ elements: [] }))
      .mockResolvedValueOnce(
        reply({
          elements: [
            day(Date.UTC(2026, 9, 30), 0.02, 100),
            day(Date.UTC(2026, 9, 31), 0.01, 300),
          ],
        })
      );
    const result = await new LinkedinPageProvider().analytics('1', 't', 7);
    const engagement = result.find((r) => r.label === 'Engagement')!;
    expect(engagement).toMatchObject({
      average: true,
      unit: 'percent',
      summary: 1.25,
    });
    expect(engagement.data.map((d) => d.total)).toEqual([2, 1]);
    expect(result.find((r) => r.label === 'Clicks')!.unit).toBeUndefined();
    // The card shows a rate's trend in percentage points (Codex): 2 % on the
    // first day and 1 % on the second is -1 pp, not a relative -50.
    expect(engagement.percentageChange).toBe(-1);
  });

  it('a rate trend is the difference of the two halves, weighted', () => {
    expect(
      ratePointChange(
        [
          { rate: 0.01, weight: 100 },
          { rate: 0.02, weight: 100 },
        ],
        100
      )
    ).toBe(1);
    expect(ratePointChange([{ rate: 0.01, weight: 100 }], 100)).toBe(0);
  });
});
