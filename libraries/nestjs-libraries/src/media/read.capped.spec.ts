import http from 'node:http';
import { AddressInfo } from 'node:net';
import { fetch } from 'undici';
import { readResponseCapped } from './fetch.media.buffer';

// E2E-08-27 (APP-9): importing media from a URL buffered the whole body
// before looking at it — a server streaming gigabytes, with or without
// Content-Length, filled the backend's memory for every user.
let server: http.Server;
let base: string;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/declared') {
      res.writeHead(200, { 'content-length': String(50 * 1024 * 1024) });
      res.end();
      return;
    }
    if (req.url === '/endless') {
      res.writeHead(200);
      const chunk = Buffer.alloc(64 * 1024);
      const timer = setInterval(() => res.write(chunk), 1);
      res.on('close', () => clearInterval(timer));
      return;
    }
    res.end(Buffer.alloc(1000));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('readResponseCapped', () => {
  it('reads a body under the cap', async () => {
    expect((await readResponseCapped(await fetch(`${base}/small`), 1024 * 1024)).length).toBe(1000);
  });

  it('refuses a declared size over the cap without reading it', async () => {
    await expect(readResponseCapped(await fetch(`${base}/declared`), 1024 * 1024)).rejects.toThrow(/larger than/);
  });

  it('stops a body without Content-Length once it passes the cap', async () => {
    await expect(readResponseCapped(await fetch(`${base}/endless`), 1024 * 1024)).rejects.toThrow(/larger than/);
  });
});
