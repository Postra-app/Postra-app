import 'reflect-metadata';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';

// Facebook stamps a daily insight with the end of its day. Shown under that
// stamp, launch day's numbers appeared a day late and the series ended with a
// row dated tomorrow.
describe('Facebook analytics days', () => {
  afterEach(() => jest.restoreAllMocks());

  it('puts each value under the day it is for', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        data: [
          {
            name: 'page_post_engagements',
            values: [
              { value: 5, end_time: '2026-11-23T08:00:00+0000' },
              { value: 19, end_time: '2026-11-24T08:00:00+0000' },
              { value: 0, end_time: '2026-11-25T08:00:00+0000' },
            ],
          },
        ],
      }),
    } as Response);

    const [metric] = await new FacebookProvider().analytics('page-1', 'token', 7);

    expect(metric.data).toEqual([
      { total: 5, date: '2026-11-22' },
      { total: 19, date: '2026-11-23' },
      { total: 0, date: '2026-11-24' },
    ]);
  });
});
