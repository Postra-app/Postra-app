const recordAiUsage = jest.fn();
jest.mock('@gitroom/nestjs-libraries/services/ai-usage.record', () => ({ recordAiUsage }));

import { HttpException, Logger } from '@nestjs/common';
import { removeBackground, UNAVAILABLE, UNREADABLE } from './background-removal';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('removeBackground (Photoroom)', () => {
  const env = { ...process.env };
  let fetchSpy: jest.SpyInstance;
  let errors: jest.SpyInstance;

  beforeEach(() => {
    process.env.PHOTOROOM_API_KEY = 'secret-photoroom-key';
    delete process.env.PHOTOROOM_API_URL;
    recordAiUsage.mockClear();
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  const answer = (status: number, body: BodyInit) =>
    (fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body, { status })));

  it('sends the picture as image_file with the key in x-api-key and returns the PNG', async () => {
    answer(200, new Uint8Array(PNG));
    const out = await removeBackground(Buffer.from('jpeg-bytes'), 'image/jpeg', 'org-1');

    expect(out.equals(PNG)).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://sdk.photoroom.com/v1/segment');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'x-api-key': 'secret-photoroom-key' });
    const file = (init.body as FormData).get('image_file') as Blob;
    expect(file.type).toBe('image/jpeg');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('jpeg-bytes');
  });

  it('meters one image for the organisation on success only', async () => {
    answer(200, new Uint8Array(PNG));
    await removeBackground(PNG, 'image/png', 'org-1');
    expect(recordAiUsage).toHaveBeenCalledWith({
      organizationId: 'org-1',
      engine: 'background-removal',
      model: 'photoroom-segment',
      unit: 'images',
      inputAmount: 1,
    });

    answer(500, 'boom');
    await expect(removeBackground(PNG, 'image/png', 'org-1')).rejects.toThrow(UNAVAILABLE);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
  });

  it('tells the customer the picture is unreadable on 400', async () => {
    answer(400, JSON.stringify({ detail: 'bad image' }));
    const err = await removeBackground(PNG, 'image/png', 'org-1').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toBe(UNREADABLE);
  });

  it.each([401, 402, 403, 429, 503])('answers 503 when Photoroom says %s, and logs it without the key', async (status) => {
    answer(status, JSON.stringify({ detail: 'nope' }));
    const err = await removeBackground(PNG, 'image/png', 'org-1').catch((e) => e);
    expect(err.getStatus()).toBe(503);
    const line = String(errors.mock.calls.at(-1)?.[0]);
    expect(line).toContain(`[bg-remove] photoroom ${status}`);
    expect(line).not.toContain('secret-photoroom-key');
  });

  it('answers 503 without calling out when no key is set', async () => {
    delete process.env.PHOTOROOM_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');
    await expect(removeBackground(PNG, 'image/png', 'org-1')).rejects.toThrow(UNAVAILABLE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 503 when Photoroom cannot be reached', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(removeBackground(PNG, 'image/png', 'org-1')).rejects.toThrow(UNAVAILABLE);
  });
});
