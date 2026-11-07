import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { signedIn } from '../helpers';

// Studio's Remove background on the real app code, with fake-openai.mjs
// standing in for Photoroom (stack.env PHOTOROOM_API_URL). The cut-out is a
// new file in the media library, as Studio puts it back on the canvas.

const photo = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .toBuffer();

test('a photo comes back as a transparent PNG kept in the library', async () => {
  const owner = await signedIn('a');
  try {
    const name = `product-${Date.now()}.jpg`;
    const res = await owner.post('/media/remove-background', {
      multipart: { file: { name, mimeType: 'image/jpeg', buffer: await photo() } },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body.path).toMatch(/\.png$/);
    expect(body.originalName).toBe(name.replace('.jpg', ' (background removed).png'));

    const list = await (await owner.get('/media?page=1')).json();
    expect((list.results as { id: string }[]).some((m) => m.id === body.id)).toBe(true);
  } finally {
    await owner.dispose();
  }
});

test('anything that is not a picture is refused before Photoroom is asked', async () => {
  const owner = await signedIn('a');
  try {
    const before = (await (await owner.get('http://localhost:58090/__requests')).json()).length;
    const res = await owner.post('/media/remove-background', {
      multipart: { file: { name: 'notes.txt', mimeType: 'image/png', buffer: Buffer.from('not a picture') } },
    });
    expect(res.status()).toBe(422);
    const after = (await (await owner.get('http://localhost:58090/__requests')).json()) as { path: string }[];
    expect(after.slice(before).filter((r) => r.path.includes('photoroom'))).toEqual([]);
  } finally {
    await owner.dispose();
  }
});
