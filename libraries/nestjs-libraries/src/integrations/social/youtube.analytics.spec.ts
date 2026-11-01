import 'reflect-metadata';
import { google } from 'googleapis';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

// Post statistics with an expired or revoked token: the 401 was swallowed into
// "no statistics" for good. A RefreshToken lets checkPostAnalytics refresh the
// token and retry once (upstream 96b78476).

const failWith = (status: number) =>
  jest.spyOn(google, 'youtube').mockReturnValue({
    videos: {
      list: jest.fn().mockRejectedValue({ response: { status, data: { error: 'x' } } }),
    },
  } as any);

describe('YouTube post analytics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks for a token refresh on 401', async () => {
    failWith(401);
    await expect(
      new YoutubeProvider().postAnalytics('ch', 'expired', 'video-1', 7)
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it('still answers empty on other errors', async () => {
    failWith(500);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      new YoutubeProvider().postAnalytics('ch', 'token', 'video-1', 7)
    ).resolves.toEqual([]);
  });
});

// "Average View Duration" is seconds and read "95.00%"; both averages were a
// plain mean of the days, a day with one view counting like a busy one.
describe('YouTube channel analytics averages', () => {
  afterEach(() => jest.restoreAllMocks());

  it('weights the averages by views and gives their units', async () => {
    jest.spyOn(google, 'youtubeAnalytics').mockReturnValue({
      reports: {
        query: jest.fn().mockResolvedValue({
          data: {
            columnHeaders: [
              { name: 'day' },
              { name: 'views' },
              { name: 'averageViewDuration' },
              { name: 'averageViewPercentage' },
            ],
            rows: [
              ['2026-10-30', 1, 10, 10],
              ['2026-10-31', 3, 130, 50],
            ],
          },
        }),
      },
    } as any);
    const result = await new YoutubeProvider().analytics('ch', 'token', 7);
    const duration = result.find((r) => r.label === 'Average View Duration')!;
    const percentage = result.find((r) => r.label === 'Average View Percentage')!;
    expect(duration).toMatchObject({ average: true, unit: 'seconds', summary: 100 });
    expect(percentage).toMatchObject({ average: true, unit: 'percent', summary: 40 });
    expect(result.find((r) => r.label === 'Likes')!.unit).toBeUndefined();
  });
});
