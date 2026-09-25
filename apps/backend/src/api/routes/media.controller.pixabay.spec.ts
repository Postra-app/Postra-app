// The controller module pulls isomorphic-dompurify and nostr-tools through its
// DTO and provider imports; neither starts in jest here and neither matters.
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn() },
}));

import { gzipSync } from 'zlib';
import { HttpException } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { MediaController } from './media.controller';

const controller = new MediaController({} as any, {} as any, {} as any);
const payload = { total: 1, hits: [{ id: 7 }] };

const answer = (body: Buffer | string) =>
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(body, { status: 200, headers: { 'x-ratelimit-remaining': '99' } })
    );

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : String(e);
  }
};

describe('Pixabay stock search', () => {
  const env = process.env.PIXABAY_API_KEY;
  beforeAll(() => {
    process.env.PIXABAY_API_KEY = 'test-key';
  });
  afterAll(() => {
    process.env.PIXABAY_API_KEY = env;
  });
  beforeEach(() => {
    jest.restoreAllMocks();
    (ioRedis.get as jest.Mock).mockResolvedValue(null);
    (ioRedis.set as jest.Mock).mockReset();
  });

  it('reads a plain JSON body and caches it', async () => {
    answer(JSON.stringify(payload));
    await expect(controller.pixabayImages('business', '1')).resolves.toEqual(payload);
    expect(ioRedis.set).toHaveBeenCalled();
  });

  it('inflates a body that arrives still gzipped, on both routes', async () => {
    answer(gzipSync(JSON.stringify(payload)));
    await expect(controller.pixabayImages('business', '1')).resolves.toEqual(payload);
    answer(gzipSync(JSON.stringify(payload)));
    await expect(controller.pixabayVideos('business', '1')).resolves.toEqual(payload);
  });

  it('an unreadable body is a 502 and is not cached', async () => {
    answer('<html>busy</html>');
    expect(await statusOf(controller.pixabayImages('business', '1'))).toBe(502);
    answer(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01]));
    expect(await statusOf(controller.pixabayVideos('business', '1'))).toBe(502);
    expect(ioRedis.set).not.toHaveBeenCalled();
  });
});
