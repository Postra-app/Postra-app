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
