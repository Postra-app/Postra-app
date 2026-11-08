import { APIRequestContext, expect, test } from '@playwright/test';
import { draftBody, listPosts, signedIn } from '../helpers';

// A phone on a slow connection timed out on "Save", retried, and the post was
// saved twice. A retry with the same Idempotency-Key gets the first answer.
let api: APIRequestContext;
test.beforeAll(async () => {
  api = await signedIn('a');
});
test.afterAll(async () => api.dispose());

test('a retry with the same Idempotency-Key saves the post once', async () => {
  const content = `[stack] idempotent ${Date.now()}`;
  const key = `stack-${Date.now()}-retry`;
  const body = draftBody('a', content);
  const first = await api.post('/posts', { data: body, headers: { 'Idempotency-Key': key } });
  expect(first.status(), await first.text()).toBe(201);
  const again = await api.post('/posts', { data: body, headers: { 'Idempotency-Key': key } });
  expect(again.status(), await again.text()).toBe(201);
  expect(await again.json()).toEqual(await first.json());
  expect((await listPosts(api)).filter((p) => p.content === content)).toHaveLength(1);

  const other = await api.post('/posts', { data: draftBody('a', `${content} changed`), headers: { 'Idempotency-Key': key } });
  expect(other.status()).toBe(422);

  const posts = (await listPosts(api)).filter((p) => p.content.startsWith(content));
  for (const p of posts) await api.delete(`/posts/${p.group}`);
});

test('without the header nothing changes: two requests, two posts', async () => {
  const content = `[stack] no key ${Date.now()}`;
  for (let i = 0; i < 2; i++) {
    const res = await api.post('/posts', { data: draftBody('a', content) });
    expect(res.status()).toBe(201);
  }
  const posts = (await listPosts(api)).filter((p) => p.content === content);
  expect(posts).toHaveLength(2);
  for (const p of posts) await api.delete(`/posts/${p.group}`);
});
