jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
const fetchMediaStream = jest.fn(async () => {
  throw new Error('stop after picking the file');
});
jest.mock('@gitroom/nestjs-libraries/media/fetch.media.buffer', () => ({ fetchMediaStream }));

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PinterestProvider } from './pinterest.provider';
import { PinterestSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';

// Pinterest fixes from upstream (002a341b, 538f3e6f, 8f92a37e, cd899eaa).
describe('Pinterest', () => {
  const provider = new PinterestProvider();

  it('a board name instead of the id is explained, however the pattern is escaped', () => {
    for (const body of [
      `{"message":"board_id does not match '^\\\\d+$'"}`,
      `{"message":"board_id does not match '^\\\\\\\\d+$'"}`,
    ]) {
      expect(provider.handleErrors(body)?.value).toContain('numeric');
    }
  });

  it('a board the account cannot post to is explained', () => {
    expect(
      provider.handleErrors('{"message":"You are not permitted to access that resource."}')?.value
    ).toContain('not permitted to post to this board');
  });

  it('the composer refuses a board name before the post is queued', async () => {
    const errors = (dto: object) => validate(plainToInstance(PinterestSettingsDto, dto));
    expect(await errors({ board: '1234567890' })).toHaveLength(0);
    const [named] = await errors({ board: 'Wedding ideas' });
    expect(Object.values(named.constraints!)).toContain(
      'Board must be the numeric board id (use the boards list of the channel to find it), not the board name'
    );
  });

  it('pin analytics come from summary_metrics', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        all: {
          summary_metrics: { IMPRESSION: 120, PIN_CLICK: 7, OUTBOUND_CLICK: 3, SAVE: 2 },
          lifetime_metrics: { TOTAL_COMMENTS: 1 },
        },
      }),
    } as any);
    const result = await provider.postAnalytics('ig', 'token', 'pin-1', 30);
    fetchSpy.mockRestore();
    expect(result.map((r) => [r.label, r.data[0].total])).toEqual([
      ['Impressions', '120'],
      ['Pin Clicks', '7'],
      ['Outbound Clicks', '3'],
      ['Saves', '2'],
    ]);
  });

  it('a video pin uploads the video, not the cover that came first (upstream be413ec2)', async () => {
    (provider as any).fetch = async () => ({
      json: async () => ({ upload_url: 'https://upload', media_id: 'm1', upload_parameters: {} }),
    });
    const media = [
      { path: 'https://cdn-dev.postra.pl/cover.jpg' },
      { path: 'https://cdn-dev.postra.pl/clip.mp4' },
    ];
    await provider
      .post('pin-user', 'token', [{ id: 'p1', message: 'x', settings: { board: '123' }, media }] as any)
      .catch(() => undefined);
    expect(fetchMediaStream).toHaveBeenCalledWith('https://cdn-dev.postra.pl/clip.mp4');
  });
});
