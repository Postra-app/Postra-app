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
    expect(calls[0].url).toBe(
      'https://app.postra.co.uk/api/public/v1/integrations'
    );
    expect(calls[0].init.headers.Authorization).toBe('key');
  });

  it('accepts a base URL with a trailing slash', async () => {
    await new Postra('key', 'https://example.test/api/').integrations();
    expect(calls[0].url).toBe(
      'https://example.test/api/public/v1/integrations'
    );
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
    await expect(new Postra('key').deletePost('a/b')).resolves.toEqual({
      error: false,
    });
    expect(calls[0].url).toBe(
      'https://app.postra.co.uk/api/public/v1/posts/a%2Fb'
    );
    expect(calls[0].init.method).toBe('DELETE');
  });
  // 1.2.0: every public API route the docs describe has a method, so a user
  // of the SDK never has to drop to fetch() for the rest of the contract.
  it('covers the rest of the public API with the documented paths and verbs', async () => {
    const postra = new Postra('key');
    const base = 'https://app.postra.co.uk/api/public/v1';
    await postra.uploadFromUrl('https://example.com/a.png');
    await postra.isConnected();
    await postra.integrationSettings('ch/1');
    await postra.triggerIntegration('ch', 'channels');
    await postra.connectChannel('linkedin');
    await postra.connectChannel('linkedin', { refresh: 'ch' });
    await postra.deleteIntegration('ch');
    await postra.deletePostGroup('g/1');
    await postra.setPostStatus('p1', 'draft');
    await postra.setPostStatus('p1', 'schedule', { republish: true });
    await postra.postMissing('p1');
    await postra.setReleaseId('p1', '730');
    await postra.findSlot('ch');
    await postra.analytics('ch');
    await postra.analytics('ch', { date: 30 });
    await postra.postAnalytics('p1', { date: 7 });
    await postra.notifications();
    await postra.notifications({ page: 2 });
    const seen = calls.map(
      (c) =>
        `${c.init.method || 'GET'} ${c.url.slice(base.length)}${
          c.init.body ? ' ' + c.init.body : ''
        }`
    );
    expect(seen).toEqual([
      'POST /upload-from-url {"url":"https://example.com/a.png"}',
      'GET /is-connected',
      'GET /integration-settings/ch%2F1',
      'POST /integration-trigger/ch {"methodName":"channels","data":{}}',
      'GET /social/linkedin?',
      'GET /social/linkedin?refresh=ch',
      'DELETE /integrations/ch',
      'DELETE /posts/group/g%2F1',
      'PUT /posts/p1/status {"status":"draft"}',
      'PUT /posts/p1/status {"status":"schedule","republish":true}',
      'GET /posts/p1/missing',
      'PUT /posts/p1/release-id {"releaseId":"730"}',
      'GET /find-slot/ch',
      'GET /analytics/ch?',
      'GET /analytics/ch?date=30',
      'GET /analytics/post/p1?date=7',
      'GET /notifications?',
      'GET /notifications?page=2',
    ]);
    for (const c of calls) {
      expect(c.init.headers.Authorization).toBe('key');
      if (c.init.body)
        expect(c.init.headers['Content-Type']).toBe('application/json');
    }
  });

  it('lists the media library with page and search in the query', async () => {
    next = () => respond(200, '{"pages":1,"results":[]}');
    await new Postra('key').mediaList({ page: 2, search: 'logo' });
    expect(calls[0].url).toMatch(/\/public\/v1\/media\?page=2&search=logo$/);
    await new Postra('key').mediaList();
    expect(calls[1].url).toMatch(/\/public\/v1\/media\?$/);
  });
});
