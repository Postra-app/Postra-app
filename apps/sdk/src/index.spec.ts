import Postra, { PostraError } from './index';

const calls: { url: string; init: any }[] = [];
const respond = (status: number, body: string, headers = {}) =>
  new Response(body, { status, headers });

describe('@postra/node', () => {
  const realFetch = global.fetch;
  let next: () => Response;

  beforeEach(() => {
    calls.length = 0;
    next = () => respond(200, '[]');
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return next();
    }) as any;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('talks to the public API under /api by default', async () => {
    await new Postra('key').integrations();
    expect(calls[0].url).toBe('https://app.postra.pl/api/public/v1/integrations');
    expect(calls[0].init.headers.Authorization).toBe('key');
  });

  it('accepts a base URL with a trailing slash', async () => {
    await new Postra('key', 'https://example.test/api/').integrations();
    expect(calls[0].url).toBe('https://example.test/api/public/v1/integrations');
  });

  it('turns a redirect to the login page into an error, not a JSON crash', async () => {
    next = () => respond(307, '', { location: '/auth/login' });
    await expect(new Postra('key').integrations()).rejects.toMatchObject({
      name: 'PostraError',
      status: 307,
    });
  });

  it('carries the API message on 4xx', async () => {
    next = () => respond(401, '{"msg":"Invalid API key"}');
    const err = await new Postra('bad').integrations().catch((e) => e);
    expect(err).toBeInstanceOf(PostraError);
    expect(err.body).toEqual({ msg: 'Invalid API key' });
  });

  it('uploads the file under "file" with a real file name', async () => {
    next = () => respond(201, '{"id":"m1","path":"https://cdn/x.png"}');
    const res = await new Postra('key').upload(Buffer.from([1, 2, 3]), '.PNG');
    expect(res.id).toBe('m1');
    const form = calls[0].init.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('upload.png');
    expect(file.type).toBe('image/png');
  });

  it('parses the delete response like every other call', async () => {
    next = () => respond(200, '{"error":false}');
    await expect(new Postra('key').deletePost('a/b')).resolves.toEqual({ error: false });
    expect(calls[0].url).toBe('https://app.postra.pl/api/public/v1/posts/a%2Fb');
    expect(calls[0].init.method).toBe('DELETE');
  });
});
