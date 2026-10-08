import { videoUrlOf } from '@gitroom/nestjs-libraries/videos/veo3/veo3';

describe('the finished clip in a kie.ai record', () => {
  it("reads veo-3-1's real shape: the 1080p result_urls under data (prod 2026-10-08)", () => {
    expect(
      videoUrlOf({
        resultJson: JSON.stringify({
          code: 200,
          data: { origin_urls: ['https://t/720.mp4'], result_urls: ['https://t/1080.mp4'] },
        }),
      })
    ).toBe('https://t/1080.mp4');
  });

  it('falls back to the 720p origin, then to the response copy, then to the documented resultUrls', () => {
    expect(videoUrlOf({ resultJson: JSON.stringify({ data: { origin_urls: ['https://t/720.mp4'] } }) })).toBe(
      'https://t/720.mp4'
    );
    expect(videoUrlOf({ resultJson: '', response: { data: { result_urls: ['https://t/r.mp4'] } } })).toBe(
      'https://t/r.mp4'
    );
    expect(videoUrlOf({ resultJson: JSON.stringify({ resultUrls: ['https://t/doc.mp4'] }) })).toBe(
      'https://t/doc.mp4'
    );
  });

  it('has nothing to return when there is no URL, or the JSON is broken', () => {
    expect(videoUrlOf({ resultJson: '{"code":200,"data":{}}' })).toBeUndefined();
    expect(videoUrlOf({ resultJson: 'not json' })).toBeUndefined();
  });
});
