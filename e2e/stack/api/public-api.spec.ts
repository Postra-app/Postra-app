import { APIRequestContext, expect, request, test } from '@playwright/test';
import { BACKEND_URL, channelOf, signedIn } from '../helpers';
import { USERS } from '../seed';

// The public API (/public/v1) that customers' automations call with an
// organisation API key — n8n, Zapier, scripts. A separate auth path from the
// app's session cookie, so it gets its own isolation cases.

const withKey = (key?: string) =>
  request.newContext({
    // Trailing slash + relative paths: a path starting with / would replace
    // /public/v1 and silently hit the app's own routes.
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: key ? { authorization: key } : {},
  });

let a: APIRequestContext;
let b: APIRequestContext;
test.beforeAll(async () => {
  a = await withKey(USERS.a.apiKey);
  b = await withKey(USERS.b.apiKey);
});
test.afterAll(async () => {
  await a.dispose();
  await b.dispose();
});

const draft = (channel: string, content: string) => ({
  type: 'draft',
  shortLink: false,
  date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  tags: [],
  posts: [
    {
      integration: { id: channel },
      value: [{ content, image: [] }],
      settings: { __type: 'bluesky' },
    },
  ],
});

test('no key and a wrong key are 401', async () => {
  for (const key of [undefined, 'not-a-key', 'pos_not-a-token']) {
    const api = await withKey(key);
    const res = await api.get('integrations');
    expect(res.status(), String(key)).toBe(401);
    await api.dispose();
  }
});

test('a key sees its own organisation only', async () => {
  const res = await a.get('integrations');
  expect(res.status()).toBe(200);
  const body = JSON.stringify(await res.json());
  expect(body).toContain(channelOf('a'));
  expect(body).not.toContain(channelOf('b'));
  expect((await a.get('is-connected')).status()).toBe(200);
});

test('a draft created through the API is listed and can be deleted', async () => {
  const content = `[stack] public api ${Date.now()}`;
  const created = await a.post('posts', { data: draft(channelOf('a'), content) });
  expect(created.status(), await created.text()).toBe(201);
  const [post] = (await created.json()) as { postId: string; integration: string }[];
  expect(post.postId).toBeTruthy();

  // B's key can neither delete it nor see it.
  expect((await b.delete(`posts/${post.postId}`)).status()).toBe(404);

  expect((await a.delete(`posts/${post.postId}`)).status()).toBe(200);
});

test("a key cannot post to another organisation's channel", async () => {
  const res = await b.post('posts', {
    data: draft(channelOf('a'), '[stack] public api foreign channel'),
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});

test('upload-from-url refuses addresses inside our network', async () => {
  for (const url of [
    'http://localhost:58080/health',
    'http://127.0.0.1:53000/monitor/queue/main',
    'http://169.254.169.254/latest/meta-data/',
  ]) {
    const res = await a.post('upload-from-url', { data: { url } });
    expect(res.status(), url).toBeGreaterThanOrEqual(400);
    expect(res.status(), url).toBeLessThan(500);
  }
});

// E2E-08-58: a file uploaded through the API kept only its random stored name,
// so the library search (by original name) never found it.
test('a file uploaded through the API is found by its name in the library', async () => {
  const name = `stack-api-upload-${Date.now()}.png`;
  // 1×1 transparent PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const res = await a.post('upload', { multipart: { file: { name, mimeType: 'image/png', buffer: png } } });
  expect(res.status(), await res.text()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const app = await signedIn('a');
  try {
    const found = await app.get(`/media?page=1&search=${encodeURIComponent(name)}`);
    expect(found.status()).toBe(200);
    const body = await found.json();
    const results: { id: string }[] = body.results ?? body.media ?? body;
    expect(results.map((m) => m.id)).toContain(id);
  } finally {
    await app.delete(`/media/${id}`);
    await app.dispose();
  }
});
