import { Veo3, videoUrlOf } from '@gitroom/nestjs-libraries/videos/veo3/veo3';

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

// The clip is made from a description alone too, but the parameters required
// `images`: the public API and the MCP tool with only a prompt were refused
// with "images must be an array" before anything was generated.
describe('Veo 3.1 parameters', () => {
  const veo = new Veo3();

  it('a description without images is accepted', async () => {
    await expect(veo.processAndValidate({ prompt: 'A lighthouse at dusk' } as any)).resolves.toBeUndefined();
  });

  it('more than 3 images, or no description, is still refused', async () => {
    const image = { id: 'm1', path: 'https://cdn.example/a.jpg' };
    await expect(veo.processAndValidate({ prompt: 'x', images: [image, image, image, image] })).rejects.toBeTruthy();
    await expect(veo.processAndValidate({ images: [image] } as any)).rejects.toBeTruthy();
  });
});
