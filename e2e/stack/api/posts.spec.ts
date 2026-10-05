import { APIRequestContext, expect, test } from '@playwright/test';
import { createDraft, draftBody, listPosts, signedIn } from '../helpers';

// Contracts the composer and calendar rely on. Each E2E-05-* case was a 500
// or a silent success on production before it was fixed (e2e/bugs.md).

let api: APIRequestContext;
test.beforeAll(async () => {
  api = await signedIn('a');
});
test.afterAll(async () => {
  await api.dispose();
});

const unique = (label: string) => `[stack] ${label} ${Date.now()}-${Math.random()}`;

test('a draft is created, listed, read and deleted', async () => {
  const text = unique('lifecycle');
  const post = await createDraft(api, 'a', text);

  const read = await api.get(`/posts/${post.id}`);
  expect(read.status()).toBe(200);
  expect(JSON.stringify(await read.json())).toContain(text);

  const del = await api.delete(`/posts/${post.group}`);
  expect(del.status()).toBe(200);
  expect(await del.json()).toMatchObject({ deleted: true });
  expect((await listPosts(api)).some((p) => p.content.includes(text))).toBe(false);
});

test('E2E-05-01: deleting a group twice reports the second time honestly', async () => {
  const post = await createDraft(api, 'a', unique('double delete'));
  expect(await (await api.delete(`/posts/${post.group}`)).json()).toMatchObject({
    deleted: true,
  });
  expect(await (await api.delete(`/posts/${post.group}`)).json()).toMatchObject({
    deleted: false,
  });
});

test('E2E-05-02: an unknown post id is 404, not a crash', async () => {
  for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-post']) {
    expect((await api.get(`/posts/${id}`)).status(), id).toBe(404);
  }
});

test('E2E-05-08: posts that is not an array is 400 on both routes', async () => {
  for (const path of ['/posts', '/posts/valid']) {
    const res = await api.post(path, {
      data: draftBody('a', unique('bad shape'), { posts: { not: 'an array' } }),
    });
    expect(res.status(), path).toBe(400);
  }
});

test('an unknown post type is refused', async () => {
  const res = await api.post('/posts', {
    data: draftBody('a', unique('bad type'), { type: 'publish-everything' }),
  });
  expect(res.status()).toBe(400);
});

test('E2E-05-12: moving a post refuses a bad date and an unknown post', async () => {
  const post = await createDraft(api, 'a', unique('move'));
  const bad = await api.put(`/posts/${post.id}/date`, {
    data: { date: 'not-a-date' },
  });
  expect(bad.status()).toBe(400);
  const unknown = await api.put('/posts/00000000-0000-4000-8000-000000000000/date', {
    data: { date: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(unknown.status()).toBe(404);
  await api.delete(`/posts/${post.group}`);
});

test('E2E-05-20: a release id for a post that is not waiting for one is 404', async () => {
  const post = await createDraft(api, 'a', unique('release id'));
  const res = await api.put(`/posts/${post.id}/release-id`, {
    data: { releaseId: 'platform-123' },
  });
  expect(res.status()).toBe(404);
  await api.delete(`/posts/${post.group}`);
});

test('E2E-05-16: an empty comment is refused', async () => {
  const post = await createDraft(api, 'a', unique('comment'));
  const res = await api.post(`/posts/${post.id}/comments`, {
    data: { comment: '   ' },
  });
  expect(res.status()).toBe(400);
  await api.delete(`/posts/${post.group}`);
});

test('tags: create, rename, delete; an unknown tag is 404', async () => {
  const name = unique('tag').slice(0, 40);
  const created = await api.post('/posts/tags', {
    data: { name, color: '#38bdf8' },
  });
  expect(created.status()).toBe(201);
  const tag: { id: string } = await created.json();

  const renamed = await api.put(`/posts/tags/${tag.id}`, {
    data: { name: `${name}-2`, color: '#a78bfa' },
  });
  expect(renamed.status()).toBe(200);

  expect((await api.delete(`/posts/tags/${tag.id}`)).status()).toBe(200);

  // Unknown or already deleted: 404 (was a Prisma P2025 → 500, and a deleted
  // tag could still be renamed).
  expect((await api.delete(`/posts/tags/${tag.id}`)).status()).toBe(404);
  expect(
    (await api.put(`/posts/tags/${tag.id}`, { data: { name, color: '#38bdf8' } })).status()
  ).toBe(404);
  expect(
    (await api.delete('/posts/tags/00000000-0000-4000-8000-000000000000')).status()
  ).toBe(404);
});

test('E2E-05-43: a repeat interval below one day is refused', async () => {
  // `inter: -1` was stored as is: the workflow clamped the delay to zero and
  // every publication started the next one at once — a post repeating
  // without end on the customer's channel.
  const api = await signedIn('a');
  try {
    for (const inter of [-1, 0, 0.5]) {
      const res = await api.post('/posts', { data: draftBody('a', unique(`interval ${inter}`), { inter }) });
      expect(res.status(), `inter ${inter}`).toBe(400);
    }
    const ok = await api.post('/posts', { data: draftBody('a', unique('interval 7'), { inter: 7 }) });
    expect(ok.status(), await ok.text()).toBe(201);
  } finally {
    await api.dispose();
  }
});
