import { APIRequestContext, expect, test } from '@playwright/test';
import { anonymous, channelOf, createDraft, signedIn } from '../helpers';

// Organisation B must not be able to read, change or delete anything that
// belongs to organisation A — and must not even learn that it exists (404,
// never 403). Each case here was an open door on production before the
// E2E-05-* fixes.

let a: APIRequestContext;
let b: APIRequestContext;
let post: { id: string; group: string };

test.beforeAll(async () => {
  a = await signedIn('a');
  b = await signedIn('b');
  post = await createDraft(a, 'a', `[stack] isolation ${Date.now()}`);
});
test.afterAll(async () => {
  await a.delete(`/posts/${post.group}`);
  await a.dispose();
  await b.dispose();
});

test("B cannot read A's post", async () => {
  expect((await b.get(`/posts/${post.id}`)).status()).toBe(404);
});

test("B cannot move, comment on or connect A's post", async () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  expect(
    (await b.put(`/posts/${post.id}/date`, { data: { date: tomorrow } })).status()
  ).toBe(404);
  expect(
    (await b.post(`/posts/${post.id}/comments`, { data: { comment: 'hi' } })).status()
  ).toBe(404);
  expect(
    (
      await b.put(`/posts/${post.id}/release-id`, { data: { releaseId: 'x-1' } })
    ).status()
  ).toBe(404);
});

test("B deleting A's group deletes nothing", async () => {
  const res = await b.delete(`/posts/${post.group}`);
  expect(await res.json()).toMatchObject({ deleted: false });
  expect((await a.get(`/posts/${post.id}`)).status()).toBe(200);
});

test("B's channel list does not contain A's channel", async () => {
  const res = await b.get('/integrations/list');
  expect(res.status()).toBe(200);
  const body = JSON.stringify(await res.json());
  expect(body).toContain(channelOf('b'));
  expect(body).not.toContain(channelOf('a'));
});

test("B cannot post to A's channel", async () => {
  const res = await b.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      tags: [],
      posts: [
        {
          type: 'draft',
          integration: { id: channelOf('a') },
          value: [{ content: '[stack] foreign channel', image: [] }],
          settings: { __type: 'bluesky' },
        },
      ],
    },
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});

test("E2E-05-19: B cannot put a plug on A's channel", async () => {
  const res = await b.post(`/integrations/${channelOf('a')}/plugs`, {
    data: {
      func: 'autoPlugPost',
      fields: [
        { name: 'likesAmount', value: '1' },
        { name: 'post', value: '[stack] foreign plug' },
      ],
    },
  });
  expect(res.status()).toBe(404);
  expect(
    (
      await b.put('/integrations/plugs/00000000-0000-4000-8000-000000000000/activate', {
        data: { status: false },
      })
    ).status()
  ).toBe(404);
});

test('E2E-05-18: B cannot overwrite or delete A\'s signature', async () => {
  const created = await a.post('/signatures', {
    data: { content: '[stack] signature A', autoAdd: false },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  expect(
    (await b.put(`/signatures/${id}`, { data: { content: 'taken', autoAdd: true } })).status()
  ).toBe(404);
  expect((await b.delete(`/signatures/${id}`)).status()).toBe(404);

  const mine = JSON.stringify(await (await a.get('/signatures')).json());
  expect(mine).toContain('[stack] signature A');
  expect((await a.delete(`/signatures/${id}`)).status()).toBe(200);
});

test("B cannot rename or delete A's tag", async () => {
  const created = await a.post('/posts/tags', {
    data: { name: `stack-a-${Date.now()}`, color: '#38bdf8' },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  expect(
    (await b.put(`/posts/tags/${id}`, { data: { name: 'taken', color: '#000000' } })).status()
  ).toBe(404);
  expect((await b.delete(`/posts/tags/${id}`)).status()).toBe(404);
  expect((await a.delete(`/posts/tags/${id}`)).status()).toBe(200);
});

test('E2E-05-13: the public preview leaks no internals', async () => {
  const res = await (await anonymous()).get(`/public/posts/${post.id}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  const keys = Object.keys(Array.isArray(body) ? body[0] ?? {} : body);
  for (const leaked of ['error', 'organizationId', 'token', 'deletedAt']) {
    expect(keys, leaked).not.toContain(leaked);
  }
});
