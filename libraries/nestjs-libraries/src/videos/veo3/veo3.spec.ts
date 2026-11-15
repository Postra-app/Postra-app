import { Veo3, videoUrlOf } from '@gitroom/nestjs-libraries/videos/veo3/veo3';
import { fetch } from 'undici';

jest.mock('undici', () => ({ fetch: jest.fn() }));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn(async () => undefined) }));

const kie = fetch as unknown as jest.Mock;
const answer = (body: unknown) => ({ json: async () => body });
const done = answer({
  code: 200,
  data: { state: 'success', resultJson: JSON.stringify({ data: { result_urls: ['https://t/1080.mp4'] } }) },
});


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

// kie.ai answers errors with HTTP 200 and the code in the body, and a poll
// can simply not arrive. Neither is the clip failing: the task goes on and is
// charged when it finishes.
describe('waiting for a kie.ai clip', () => {
  const veo = new Veo3();
  beforeEach(() => kie.mockReset());

  it('a poll that times out, a 429 and a page that is not JSON are asked again', async () => {
    kie
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(answer({ code: 429, msg: 'Too many requests' }))
      .mockResolvedValueOnce({ json: async () => JSON.parse('<html>') })
      .mockResolvedValueOnce(answer({ code: 200, data: { state: 'generating' } }))
      .mockResolvedValueOnce(done);
    await expect(veo.finish('task-1')).resolves.toBe('https://t/1080.mp4');
    expect(kie).toHaveBeenCalledTimes(5);
  });

  it('gives up only after six polls in a row without an answer', async () => {
    kie.mockResolvedValue(answer({ code: 500, msg: 'Server Error' }));
    await expect(veo.finish('task-2')).rejects.toThrow(/task-2 failed 6 times in a row/);
    expect(kie).toHaveBeenCalledTimes(6);
  });

  it('a good answer in between starts the count again', async () => {
    const bad = answer({ code: 500, msg: 'Server Error' });
    const waiting = answer({ code: 200, data: { state: 'generating' } });
    for (let i = 0; i < 5; i++) kie.mockResolvedValueOnce(bad);
    kie.mockResolvedValueOnce(waiting);
    for (let i = 0; i < 5; i++) kie.mockResolvedValueOnce(bad);
    kie.mockResolvedValueOnce(done);
    await expect(veo.finish('task-3')).resolves.toBe('https://t/1080.mp4');
  });

  it('a clip kie.ai failed is still refused at once, with the reason for the customer', async () => {
    kie.mockResolvedValueOnce(answer({ code: 200, data: { state: 'fail', failCode: '400', failMsg: 'flagged' } }));
    await expect(veo.finish('task-4')).rejects.toMatchObject({ status: 422 });
    expect(kie).toHaveBeenCalledTimes(1);
  });
});

describe('starting a kie.ai clip', () => {
  const veo = new Veo3();
  beforeEach(() => kie.mockReset());

  it('asks for Veo 3.1 Lite at 1080p', async () => {
    kie.mockResolvedValueOnce(answer({ code: 200, data: { taskId: 't1' } }));
    await expect(veo.start('vertical', { prompt: 'A lighthouse' })).resolves.toBe('t1');
    const sent = JSON.parse(kie.mock.calls[0][1].body);
    expect(sent).toMatchObject({
      model: 'veo-3-1',
      input: { model: 'veo3_lite', resolution: '1080p', aspect_ratio: '9:16', generation_type: 'TEXT_2_VIDEO' },
    });
  });

  it('a 429 is asked again (kie.ai does not queue it); a third one is "unavailable"', async () => {
    kie
      .mockResolvedValueOnce(answer({ code: 429, msg: 'Too many requests' }))
      .mockResolvedValueOnce(answer({ code: 200, data: { taskId: 't2' } }));
    await expect(veo.start('horizontal', { prompt: 'A pier' })).resolves.toBe('t2');

    kie.mockReset();
    kie.mockResolvedValue(answer({ code: 429, msg: 'Too many requests' }));
    await expect(veo.start('horizontal', { prompt: 'A pier' })).rejects.toMatchObject({ status: 503 });
    expect(kie).toHaveBeenCalledTimes(3);
  });

  it('no balance or a refused key is not retried', async () => {
    kie.mockResolvedValue(answer({ code: 402, msg: 'Insufficient credits' }));
    await expect(veo.start('vertical', { prompt: 'A pier' })).rejects.toMatchObject({ status: 503 });
    expect(kie).toHaveBeenCalledTimes(1);
  });
});
