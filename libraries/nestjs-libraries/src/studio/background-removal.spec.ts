const recordAiUsage = jest.fn();
jest.mock('@gitroom/nestjs-libraries/services/ai-usage.record', () => ({ recordAiUsage }));

import { HttpException, Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  KIE_BACKGROUND_MODEL,
  prepareInput,
  removeBackground,
  resultUrlOf,
  TOO_SMALL,
  UNAVAILABLE,
  UNREADABLE,
} from './background-removal';

// Studio's Remove background through kie.ai (Recraft): a task, polled until
// it has a result URL. Polling runs with no wait here.
const FAST = { pollMs: 0, maxPolls: 3 };
const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, msg: 'success', data }));

describe('removeBackground (kie.ai, Recraft)', () => {
  const env = { ...process.env };
  let fetchSpy: jest.SpyInstance;
  let errors: jest.SpyInstance;

  beforeEach(() => {
    process.env.KIEAI_API_KEY = 'secret-kie-key';
    delete process.env.KIEAI_API_URL;
    recordAiUsage.mockClear();
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  const answers = (...responses: Response[]) => {
    fetchSpy = jest.spyOn(global, 'fetch');
    responses.forEach((r) => fetchSpy.mockResolvedValueOnce(r));
  };

  it('asks for the Recraft model on the picture URL and returns the result URL', async () => {
    answers(
      ok({ taskId: 't1' }),
      ok({ taskId: 't1', state: 'generating' }),
      ok({ taskId: 't1', state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://cdn.kie/out.png'] }) })
    );
    const url = await removeBackground('https://cdn.postra.co.uk/in.png', 'org-1', FAST);

    expect(url).toBe('https://cdn.kie/out.png');
    const [createUrl, init] = fetchSpy.mock.calls[0];
    expect(createUrl).toBe('https://api.kie.ai/api/v1/jobs/createTask');
    expect(init.headers.Authorization).toBe('Bearer secret-kie-key');
    expect(JSON.parse(init.body)).toEqual({
      model: KIE_BACKGROUND_MODEL,
      input: { image: 'https://cdn.postra.co.uk/in.png' },
    });
    expect(fetchSpy.mock.calls[1][0]).toBe('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=t1');
  });

  it('meters one image for the organisation once there is a result', async () => {
    answers(
      ok({ taskId: 't1' }),
      ok({ state: 'success', resultJson: { resultUrls: ['https://cdn.kie/out.png'] } })
    );
    await removeBackground('https://x/in.png', 'org-1', FAST);
    expect(recordAiUsage).toHaveBeenCalledWith({
      organizationId: 'org-1',
      engine: 'background-removal',
      model: 'recraft-remove-background',
      unit: 'images',
      inputAmount: 1,
    });
  });

  it('a task kie.ai fails is the picture: 422, nothing metered', async () => {
    answers(ok({ taskId: 't1' }), ok({ state: 'fail', failCode: '400', failMsg: 'no subject' }));
    const err = await removeBackground('https://x/in.png', 'org-1', FAST).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toBe(UNREADABLE);
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it.each([401, 402, 429])('a refused task (%s) is ours: 503, logged without the key', async (code) => {
    answers(new Response(JSON.stringify({ code, msg: 'nope' })));
    const err = await removeBackground('https://x/in.png', 'org-1', FAST).catch((e) => e);
    expect(err.getStatus()).toBe(503);
    expect(err.message).toBe(UNAVAILABLE);
    const line = String(errors.mock.calls.at(-1)?.[0]);
    expect(line).toContain(`createTask refused: ${code}`);
    expect(line).not.toContain('secret-kie-key');
  });

  it('gives up with 503 when the task never finishes', async () => {
    answers(ok({ taskId: 't1' }), ok({ state: 'generating' }), ok({ state: 'generating' }), ok({ state: 'generating' }));
    await expect(removeBackground('https://x/in.png', 'org-1', FAST)).rejects.toThrow(UNAVAILABLE);
  });

  it('answers 503 without calling out when no key is set', async () => {
    delete process.env.KIEAI_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');
    await expect(removeBackground('https://x/in.png', 'org-1', FAST)).rejects.toThrow(UNAVAILABLE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads resultUrls from resultJson as text or as an object', () => {
    expect(resultUrlOf({ resultJson: '{"resultUrls":["a"]}' })).toBe('a');
    expect(resultUrlOf({ resultJson: { resultUrls: ['b'] } })).toBe('b');
    expect(resultUrlOf({ resultJson: '' })).toBeUndefined();
  });
});

describe('prepareInput (kie.ai limits)', () => {
  const image = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#3366cc' } }).png().toBuffer();

  it('keeps a picture inside the limits as it is', async () => {
    const out = await prepareInput(await image(800, 600));
    expect(await sharp(out).metadata()).toMatchObject({ width: 800, height: 600, format: 'png' });
  });

  it('brings a picture over 4096 px down to 4096 on its long side', async () => {
    const meta = await sharp(await prepareInput(await image(5000, 1000))).metadata();
    expect(meta.width).toBe(4096);
    expect(meta.height).toBe(819);
  });

  it('refuses a picture under 256 px a side', async () => {
    await expect(prepareInput(await image(300, 200))).rejects.toThrow(TOO_SMALL);
  });

  it('refuses bytes that are not a picture', async () => {
    await expect(prepareInput(Buffer.from('not a picture'))).rejects.toThrow(UNREADABLE);
  });
});
