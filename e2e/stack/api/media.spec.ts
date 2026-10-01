import { APIRequestContext, expect, test } from '@playwright/test';
import { signedIn } from '../helpers';

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
