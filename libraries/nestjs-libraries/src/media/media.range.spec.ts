const fetchMock = jest.fn();
jest.mock('undici', () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({ ssrfSafeDispatcher: {} }));
const safe = jest.fn(async (url: string) => url.startsWith('https://cdn-dev.postra.pl/'));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: (url: string) => safe(url),
}));

import { mediaRange, MediaRangeUnsupported, mediaSize } from './media.range';

// Reading a large video part by part (U5): the size without downloading,
// exactly the bytes asked for, and a loud failure when storage ignores ranges.
const VIDEO = 'https://cdn-dev.postra.pl/uploads/clip.mp4';

const answer = (status: number, body: Buffer, headers: Record<string, string> = {}) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
  body: { cancel: async () => undefined },
});

beforeEach(() => fetchMock.mockReset());

describe('mediaSize', () => {
  it('asks with HEAD and identity encoding, and reads Content-Length', async () => {
    fetchMock.mockResolvedValue(answer(200, Buffer.alloc(0), { 'content-length': '300000000' }));
    await expect(mediaSize(VIDEO)).resolves.toBe(300_000_000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(VIDEO);
    expect(init.method).toBe('HEAD');
    expect(init.headers['accept-encoding']).toBe('identity');
    expect(init.redirect).toBe('error');
  });

  it('fails without a size', async () => {
    fetchMock.mockResolvedValue(answer(200, Buffer.alloc(0)));
    await expect(mediaSize(VIDEO)).rejects.toThrow('did not report the file size');
  });

  it('never fetches an untrusted address', async () => {
    await expect(mediaSize('https://169.254.169.254/latest/meta-data')).rejects.toThrow('untrusted');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never reads a local file outside the upload directory', async () => {
    await expect(mediaSize('/etc/passwd')).rejects.toThrow('outside /uploads/');
  });
});

describe('mediaRange', () => {
  it('returns exactly the requested bytes of a 206', async () => {
    fetchMock.mockResolvedValue(answer(206, Buffer.alloc(1024, 7)));
    const part = await mediaRange(VIDEO, 2048, 3071);
    expect(part.length).toBe(1024);
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.range).toBe('bytes=2048-3071');
    expect(init.headers['accept-encoding']).toBe('identity');
  });

  it('a 200 (the whole file) is refused, it would corrupt the video', async () => {
    fetchMock.mockResolvedValue(answer(200, Buffer.alloc(5000)));
    await expect(mediaRange(VIDEO, 0, 1023)).rejects.toBeInstanceOf(MediaRangeUnsupported);
  });

  it('a short part is refused, it would shift every byte after it', async () => {
    fetchMock.mockResolvedValue(answer(206, Buffer.alloc(1000)));
    await expect(mediaRange(VIDEO, 0, 1023)).rejects.toThrow('got 1000 bytes of 1024');
  });
});
