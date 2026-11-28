import 'reflect-metadata';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { request } from 'gaxios';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

// A YouTube call with an expired token fails with HTTP 401. The provider
// recognised it by "Unauthorized" in the serialised error, which came from
// the response's statusText. gaxios 7 and later (googleapis 150+) keep the
// response as a fetch Response, whose statusText JSON leaves out, so the word
// is gone and the customer got the other message. The error is made here the
// way googleapis makes it: gaxios requesting a server that answers like
// Google does.

const GOOGLE_401 = {
  error: {
    code: 401,
    message:
      'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.',
    errors: [{ message: 'Invalid Credentials', domain: 'global', reason: 'authError' }],
    status: 'UNAUTHENTICATED',
  },
};

let server: Server;
let url: string;
beforeAll(async () => {
  server = createServer((_, res) => {
    res.writeHead(401, { 'content-type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify(GOOGLE_401));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/youtube/v3/channels`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('YouTube: an expired token', () => {
  it('is a refresh with the reconnect message, from the error googleapis throws', async () => {
    const err = await request({ url }).catch((e) => e);
    expect(err.status).toBe(401);
    expect(new YoutubeProvider().handleErrors(JSON.stringify(err))).toEqual({
      type: 'refresh-token',
      value: 'Token expired or invalid, please reconnect your YouTube account.',
    });
  });
});
