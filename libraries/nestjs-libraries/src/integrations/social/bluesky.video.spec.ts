import { videoUploadRequest } from './bluesky.provider';

// E2E-05-29: every Bluesky video failed with "fetch failed" — undici rejected
// the hand-set Content-Length ("invalid content-length header").
describe('Bluesky video upload request', () => {
  const body = Buffer.from('mp4-bytes');
  const req = videoUploadRequest(
    'did:plc:abc',
    'https://cdn-dev.postra.pl/uploads/2026/10/03/clip.mp4?v=1',
    'tok',
    body
  );

  it('leaves Content-Length to fetch', () => {
    const headers = req.init.headers as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('content-length');
    expect(headers['Content-Type']).toBe('video/mp4');
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('names the file without the query string', () => {
    expect(req.url.searchParams.get('did')).toBe('did:plc:abc');
    expect(req.url.searchParams.get('name')).toBe('clip.mp4');
    expect(req.init.body).toBe(body);
  });

  it('sends with the length fetch computes from the Buffer', async () => {
    const http = await import('node:http');
    let received: { length?: string; bytes: number } | undefined;
    const server = http.createServer((rq, rs) => {
      let bytes = 0;
      rq.on('data', (c) => (bytes += c.length));
      rq.on('end', () => {
        received = { length: rq.headers['content-length'], bytes };
        rs.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, req.init);
      expect(res.ok).toBe(true);
      expect(received).toEqual({ length: String(body.length), bytes: body.length });

    } finally {
      server.close();
    }
  });
});
