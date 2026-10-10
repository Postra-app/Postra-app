import { APIRequestContext, expect, test } from '@playwright/test';
import { channelOf, signedIn } from '../helpers';

// The media library: upload, list, read, describe, delete — and organisation
// B can touch none of A's files.

// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

type Media = { id: string; name: string; path: string };

let a: APIRequestContext;
let b: APIRequestContext;
test.beforeAll(async () => {
  a = await signedIn('a');
  b = await signedIn('b');
});
test.afterAll(async () => {
  await a.dispose();
  await b.dispose();
});

const upload = async (api: APIRequestContext, name: string): Promise<Media> => {
  const res = await api.post('/media/upload-simple', {
    multipart: { file: { name, mimeType: 'image/png', buffer: PNG } },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
};

const library = async (api: APIRequestContext): Promise<Media[]> => {
  const res = await api.get('/media?page=1');
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.results ?? body.media ?? body;
};

test('an image is uploaded, listed, read and deleted', async () => {
  const media = await upload(a, `stack-${Date.now()}.png`);
  expect(media.id).toBeTruthy();
  expect((await library(a)).some((m) => m.id === media.id)).toBe(true);

  expect((await a.get(`/media/${media.id}`)).status()).toBe(200);

  expect((await a.delete(`/media/${media.id}`)).status()).toBe(200);
  expect((await library(a)).some((m) => m.id === media.id)).toBe(false);
});

test('a file that is not an image or video is refused', async () => {
  const res = await a.post('/media/upload-simple', {
    multipart: {
      file: { name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from('<script>1</script>') },
    },
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});

test('literal media routes are not swallowed by /media/:id', async () => {
  // /media/video-options sat below @Get('/:id') and never ran (an empty 200
  // from /:id instead); after /:id learnt to say 404 the composer got a 404.
  const res = await a.get('/media/video-options');
  expect(res.status()).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test('an unknown media id is 404 to read, describe and delete', async () => {
  expect((await a.get(`/media/${UNKNOWN}`)).status()).toBe(404);
  expect((await a.delete(`/media/${UNKNOWN}`)).status()).toBe(404);
  expect(
    (
      await a.post('/media/information', {
        data: { id: UNKNOWN, alt: 'x', thumbnail: '', thumbnailTimestamp: 0 },
      })
    ).status()
  ).toBe(404);
});

test("B cannot see, read, describe or delete A's media", async () => {
  const media = await upload(a, `stack-private-${Date.now()}.png`);

  expect((await library(b)).some((m) => m.id === media.id)).toBe(false);
  expect((await b.get(`/media/${media.id}`)).status()).toBe(404);
  expect(
    (
      await b.post('/media/information', {
        data: { id: media.id, alt: 'taken', thumbnail: '', thumbnailTimestamp: 0 },
      })
    ).status()
  ).toBe(404);
  expect((await b.delete(`/media/${media.id}`)).status()).toBe(404);

  // Still there, unchanged, for A.
  expect((await library(a)).some((m) => m.id === media.id)).toBe(true);
  expect((await a.delete(`/media/${media.id}`)).status()).toBe(200);
});

// E2E-02-07: the name is stored as the file's path under the bucket URL.
test('save-media refuses a name that is a path', async () => {
  const api = await signedIn('a');
  for (const name of ['../../evil.html', 'a/../../../etc/passwd', '.hidden', 'x/y.png']) {
    expect((await api.post('/media/save-media', { data: { name } })).status(), name).toBe(400);
  }
  await api.dispose();
});

// E2E-06-33 (K. 2026-10-10: refuse it): the nightly sweep removes the files of
// media deleted from the library. A post saved with such a file in the moment
// between the sweep's last look and the removal lost its picture. A picture
// deleted from the library cannot be added to a post; one the post already
// had stays editable.
test('a picture deleted from the library cannot be added to a post, but an existing one keeps it', async () => {
  const kept = await upload(a, `stack-kept-${Date.now()}.png`);
  const draft = (image: Media[], id?: string) => ({
    type: 'draft',
    shortLink: false,
    date: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    tags: [],
    posts: [
      {
        integration: { id: channelOf('a') },
        value: [{ ...(id ? { id } : {}), content: `[stack] deleted media ${Date.now()}`, image: image.map(({ id, path }) => ({ id, path })) }],
        settings: { __type: 'bluesky' },
      },
    ],
  });

  // A post that already has the picture, then the picture leaves the library.
  const saved = await a.post('/posts', { data: draft([kept]) });
  expect(saved.status(), await saved.text()).toBe(201);
  const [{ postId }] = await saved.json();
  expect((await a.delete(`/media/${kept.id}`)).status()).toBe(200);

  const fresh = await a.post('/posts', { data: draft([kept]) });
  expect(fresh.status()).toBe(400);
  expect((await fresh.json()).message).toContain('deleted from your media library');

  const edited = await a.post('/posts', { data: draft([kept], postId) });
  expect(edited.status(), await edited.text()).toBe(201);
});
