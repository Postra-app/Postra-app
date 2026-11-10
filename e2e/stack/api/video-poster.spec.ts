import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { database, signedIn } from '../helpers';

// Every video in the phone app's Media tab was a bare play icon
// (0 of 38 videos on production had a still). A video saved to the library
// now gets a poster frame from ffmpeg, listed with the media, without
// touching `thumbnail` (the cover the customer picks for the platforms).
const MP4 = readFileSync(join(__dirname, '../ui/fixtures/two-seconds.mp4'));

test('a video saved to the library gets a poster frame, and its cover stays empty', async () => {
  test.setTimeout(90_000);
  const api = await signedIn('a');
  const prisma = database();
  let id: string | undefined;
  try {
    const res = await api.post('/media/upload-simple', {
      multipart: { file: { name: `poster-${Date.now()}.mp4`, mimeType: 'video/mp4', buffer: MP4 } },
    });
    expect(res.status(), await res.text()).toBe(201);
    id = (await res.json()).id;

    await expect
      .poll(async () => (await prisma.media.findUniqueOrThrow({ where: { id } })).poster, { timeout: 60_000 })
      .toMatch(/\.jpe?g$/);
    const row = await prisma.media.findUniqueOrThrow({ where: { id } });
    expect(row.thumbnail).toBeNull();

    // The stored file is a real JPEG (local storage on the stack: read from
    // the upload directory, the API project runs without the proxy).
    const rel = row.poster!.slice(`${process.env.FRONTEND_URL}/uploads/`.length);
    const bytes = readFileSync(join(process.env.UPLOAD_DIRECTORY!, rel));
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.length).toBeGreaterThan(1000);

    // The library list carries it, so the phone app can show it.
    const list = await (await api.get('/media?page=1')).json();
    const listed = (list.results ?? list.media ?? list).find((m: any) => m.id === id);
    expect(listed.poster).toBe(row.poster);
  } finally {
    if (id) await api.delete(`/media/${id}`);
    await api.dispose();
    await prisma.$disconnect();
  }
});
