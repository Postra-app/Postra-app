const fetchMock = jest.fn();
jest.mock('undici', () => ({ fetch: (...a: unknown[]) => fetchMock(...a) }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({
  ssrfSafeDispatcher: { pinned: true },
}));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: async () => true,
}));

import { downloadForStorage } from './download.capped';
import { S3Storage } from './s3.storage';

// A server that never stops sending: 1 MB at a time, for ever.
const endless = () => {
  let sent = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: { ok: true, status: 200, headers: new Headers(), body },
    sent: () => sent,
    cancelled: () => cancelled,
  };
};

describe('a file copied into storage from an address', () => {
  beforeEach(() => fetchMock.mockReset());

  it('stops reading at the limit instead of filling memory', async () => {
    const server = endless();
    fetchMock.mockResolvedValue(server.response);

    await expect(
      downloadForStorage('https://feeds.example/og.jpg', 1000, 3 * 1024 * 1024)
    ).rejects.toThrow('larger than 3 MB');
    expect(server.sent()).toBeLessThan(10);
    expect(server.cancelled()).toBe(true);
  });

  it('refuses by the announced size without reading', async () => {
    const server = endless();
    (server.response.headers as Headers).set('content-length', String(500 * 1024 * 1024));
    fetchMock.mockResolvedValue(server.response);

    await expect(downloadForStorage('https://feeds.example/og.jpg')).rejects.toThrow('larger than');
    expect(server.sent()).toBeLessThanOrEqual(1);
  });

  it('goes out through the address-checking dispatcher, with a time limit', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: new Response(new Uint8Array([1, 2, 3])).body,
    });

    await expect(downloadForStorage('https://feeds.example/a.png')).resolves.toEqual(Buffer.from([1, 2, 3]));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.dispatcher).toEqual({ pinned: true });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('is what the media storage uses for an address', async () => {
    const server = endless();
    (server.response.headers as Headers).set('content-length', String(500 * 1024 * 1024));
    fetchMock.mockResolvedValue(server.response);
    const storage = new S3Storage('bucket', 'eu-west-2', 'https://cdn.example', 'AKID', 'secret');
    const send = jest.fn();
    (storage as any)._client.send = send;

    await expect(storage.uploadSimple('https://pds.example/avatar.jpg')).rejects.toThrow('larger than');
    expect(send).not.toHaveBeenCalled();
  });
});
