jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: jest.fn().mockResolvedValue(true),
}));
const fetchMock = jest.fn();
jest.mock('undici', () => ({ ...jest.requireActual('undici'), fetch: (...a: unknown[]) => fetchMock(...a) }));

import { DesignRenderService, DESIGN_IMAGE_MAX_BYTES } from '@gitroom/nestjs-libraries/studio/design-render.service';

// A body without Content-Length used to be read whole before its size was
// looked at (or never looked at): a server streaming without end filled the
// backend's memory. Each download now stops at its cap while it arrives.
const endless = (chunkBytes: number, chunks: number) => {
  let sent = 0;
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      if (sent >= chunks) return controller.close();
      sent++;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
  });
  return { response: new Response(body, { status: 200 }), pulledCount: () => pulled };
};

describe('downloads stop at their cap without Content-Length', () => {
  beforeEach(() => fetchMock.mockReset());

  it('a Brand Kit logo or design background', async () => {
    const { response, pulledCount } = endless(1024 * 1024, 200);
    fetchMock.mockResolvedValue(response);
    const service = Object.create(DesignRenderService.prototype);
    const out = await (service as any).loadImage('https://logo.example/l.png');
    expect(out).toBeNull();
    // Stopped soon after the cap, not after all 200 MB.
    expect(pulledCount()).toBeLessThan(DESIGN_IMAGE_MAX_BYTES / (1024 * 1024) + 5);
  });

  it('a small logo still loads', async () => {
    const { response } = endless(1024, 3);
    fetchMock.mockResolvedValue(response);
    const service = Object.create(DesignRenderService.prototype);
    const out = await (service as any).loadImage('https://logo.example/l.png');
    expect(out?.length).toBe(3 * 1024);
  });

  it('media fetched for publishing', async () => {
    const { fetchMediaBuffer, MEDIA_FETCH_MAX_BYTES } = require('./fetch.media.buffer');
    const small = endless(1024, 2);
    fetchMock.mockResolvedValue(small.response);
    expect((await fetchMediaBuffer('https://cdn.example/a.png')).length).toBe(2048);
    expect(MEDIA_FETCH_MAX_BYTES).toBe(1024 * 1024 * 1024);
  });
});
