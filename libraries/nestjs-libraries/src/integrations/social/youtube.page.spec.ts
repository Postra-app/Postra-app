import 'reflect-metadata';
import { google } from 'googleapis';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

// E2E-04-36: the channel picked after sign-in was looked up by its public id,
// so a client could save channel C on a token of channel D — and the upload,
// which takes no channel id, went to D under C's name.

const channel = (id: string) => ({
  id,
  snippet: { title: `Channel ${id}`, customUrl: `@${id}`, thumbnails: { default: { url: '' } } },
});

const youtubeWith = (mine: string[], publicLookup: string[]) => {
  const list = jest.fn(async (params: { mine?: boolean; id?: string[] }) => ({
    data: { items: (params.mine ? mine : publicLookup).map(channel) },
  }));
  jest.spyOn(google, 'youtube').mockReturnValue({ channels: { list } } as any);
  return list;
};

describe('YouTube channel picked after sign-in', () => {
  afterEach(() => jest.restoreAllMocks());

  it("is one of the token's own channels", async () => {
    youtubeWith(['D', 'D2'], ['D2']);
    const info = await new YoutubeProvider().fetchPageInformation('token', { id: 'D2' });
    expect(info.id).toBe('D2');
  });

  it('a public channel the token does not own is refused', async () => {
    youtubeWith(['D'], ['C']);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      new YoutubeProvider().fetchPageInformation('token', { id: 'C' })
    ).rejects.toMatchObject({ status: 404, message: 'Channel not found' });
  });
});

// Upstream #1884: reconnecting after a refresh went through pages(), which
// swallows Google's error, so a revoked scope or a Workspace block read as
// "Channel not found".
describe('YouTube reconnect after a token refresh', () => {
  afterEach(() => jest.restoreAllMocks());

  it("reports Google's own error", async () => {
    const list = jest.fn().mockRejectedValue(new Error('Request had insufficient authentication scopes.'));
    jest.spyOn(google, 'youtube').mockReturnValue({ channels: { list } } as any);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(new YoutubeProvider().reConnect('root', 'D', 'token')).rejects.toThrow(
      'Request had insufficient authentication scopes.'
    );
  });

  it('a channel the token no longer owns is still "Channel not found"', async () => {
    youtubeWith(['E'], []);
    await expect(new YoutubeProvider().reConnect('root', 'D', 'token')).rejects.toThrow('Channel not found');
  });
});
