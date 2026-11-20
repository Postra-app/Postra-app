jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: async () => true,
}));
const fetchMock = jest.fn();
jest.mock('undici', () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({
  ssrfSafeDispatcher: {},
}));

import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { fetchMediaStreamWithLength } from './fetch.media.buffer';

// An upload that has to declare its size (an S3 form POST) gets the length
// from the media server, or counts the file when the server sends none.

const read = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
};

// A body that arrives in parts, `gapMs` apart, and fails if the request is
// aborted while it is being read.
const slowBody = (parts: Buffer[], gapMs: number, signal?: AbortSignal) =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      signal?.addEventListener('abort', () =>
        controller.error(new Error('aborted'))
      );
      for (const part of parts) {
        await new Promise((r) => setTimeout(r, gapMs));
        if (signal?.aborted) return;
        controller.enqueue(new Uint8Array(part));
      }
      controller.close();
    },
  });

const ourTempDirs = () =>
  readdirSync(tmpdir()).filter((d) => d.startsWith('postra-media-'));

describe('fetchMediaStreamWithLength', () => {
  beforeEach(() => fetchMock.mockReset());

  it('takes the length the server declares', async () => {
    const file = Buffer.alloc(1000, 1);
    fetchMock.mockResolvedValue(
      new Response(file, {
        headers: { 'content-length': '1000', 'content-type': 'video/mp4' },
      })
    );
    const got = await fetchMediaStreamWithLength('https://cdn.example.com/v.mp4');
    expect(got.length).toBe(1000);
    expect(got.contentType).toBe('video/mp4');
    expect((await read(got.stream)).equals(file)).toBe(true);
  });

  it('counts a file sent without a length, on disk, and removes it after', async () => {
    const before = ourTempDirs();
    const parts = [Buffer.alloc(700, 2), Buffer.alloc(300, 3)];
    fetchMock.mockImplementation(async () => new Response(slowBody(parts, 1)));
    const got = await fetchMediaStreamWithLength('https://cdn.example.com/v.mp4');
    expect(got.length).toBe(1000);
    expect((await read(got.stream)).equals(Buffer.concat(parts))).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(ourTempDirs()).toEqual(before);
  });

  it('a body slower than the headers timeout is not cut off', async () => {
    const parts = [Buffer.alloc(10, 4), Buffer.alloc(10, 5), Buffer.alloc(10, 6)];
    fetchMock.mockImplementation(
      async (_url: string, init: { signal?: AbortSignal }) =>
        new Response(slowBody(parts, 40, init.signal))
    );
    const got = await fetchMediaStreamWithLength('https://cdn.example.com/v.mp4', 50);
    expect(got.length).toBe(30);
    await read(got.stream);
  });
});
