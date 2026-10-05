import http from 'node:http';
import { AddressInfo } from 'node:net';
import { fetch } from 'undici';

// Only 127.0.0.1 counts as internal here, so a server on [::1] can play the
// public host that redirects inward.
jest.mock('./webhook.url.validator', () => ({
  isBlockedIp: (ip: string) => ip === '127.0.0.1' || ip === '::ffff:127.0.0.1',
}));

import { ssrfSafeDispatcher } from './ssrf.safe.dispatcher';

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/hop') {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/secret` });
      res.end();
      return;
    }
    res.end('INTERNAL-SECRET');
  });
  await new Promise<void>((resolve) => server.listen(0, '::', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const get = (url: string) => fetch(url, { dispatcher: ssrfSafeDispatcher });

describe('ssrfSafeDispatcher (E2E-08-26)', () => {
  it('lets an allowed host through', async () => {
    expect(await (await get(`http://[::1]:${port}/ok`)).text()).toBe('INTERNAL-SECRET');
  });

  it('refuses a literal internal IP, which never reaches DNS lookup', async () => {
    await expect(get(`http://127.0.0.1:${port}/secret`)).rejects.toThrow();
  });

  it('refuses a redirect from an allowed host to an internal IP', async () => {
    await expect(get(`http://[::1]:${port}/hop`)).rejects.toThrow();
  });
});
