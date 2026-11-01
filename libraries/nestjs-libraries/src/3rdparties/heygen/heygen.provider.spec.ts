jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn(async () => undefined) }));

import { HeygenProvider, HEYGEN_MAX_WAIT_MS } from './heygen.provider';

// The status poll was `while (true)`: a HeyGen video that stays "processing"
// kept the request (and a backend worker slot) busy for ever.
describe('HeyGen video status', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gives up after the wait limit instead of polling for ever', async () => {
    const reply = (body: object) => ({ json: async () => body } as any);
    const fetchMock = jest
      .spyOn(global, 'fetch' as any)
      .mockImplementation(async (url: any) =>
        String(url).includes('/video/generate')
          ? reply({ data: { video_id: 'v1' } })
          : reply({ data: { status: 'processing' } })
      );
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => (now += 60_000));

    await expect(
      new HeygenProvider({} as any).sendData('key', {
        voice: 'hi',
        avatar: 'a',
        aspect_ratio: 'portrait',
        captions: 'false',
        selectedVoice: 'v',
        type: 'avatar',
      })
    ).rejects.toThrow(/did not finish/);
    // One generate call, then status polls until the clock passed the limit.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(
      HEYGEN_MAX_WAIT_MS / 60_000 + 3
    );
  });
});
