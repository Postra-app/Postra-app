import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { signedIn } from '../helpers';

// Studio's Remove background on the real app code, with fake-openai.mjs
// standing in for kie.ai (stack.env KIEAI_API_URL, model
// recraft/remove-background). The cut-out is a new file in the media
// library, as Studio puts it back on the canvas.

// Both tests count kie.ai tasks from the same fake.
test.describe.configure({ mode: 'serial' });

const photo = (width = 640, height = 480) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .toBuffer();

const kieCutouts = async (api: Awaited<ReturnType<typeof signedIn>>) =>
  ((await (await api.get('http://localhost:58090/__requests')).json()) as { path: string; model?: string }[]).filter(
    (r) => r.path === '/api/v1/jobs/createTask' && r.model === 'recraft/remove-background'
  ).length;

test('a photo comes back as a cut-out kept in the library', async () => {
  const owner = await signedIn('a');
  try {
    const before = await kieCutouts(owner);
    const name = `product-${Date.now()}.jpg`;
    const res = await owner.post('/media/remove-background', {
      multipart: { file: { name, mimeType: 'image/jpeg', buffer: await photo() } },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body.originalName).toMatch(/^product-\d+ \(background removed\)\.png$/);
    expect(await kieCutouts(owner)).toBe(before + 1);

    const list = await (await owner.get('/media?page=1')).json();
    expect((list.results as { id: string }[]).some((m) => m.id === body.id)).toBe(true);
  } finally {
    await owner.dispose();
  }
});

test('anything kie.ai would refuse is refused before it is asked', async () => {
  const owner = await signedIn('a');
  try {
    const before = await kieCutouts(owner);
    const notPicture = await owner.post('/media/remove-background', {
      multipart: { file: { name: 'notes.txt', mimeType: 'image/png', buffer: Buffer.from('not a picture') } },
    });
    expect(notPicture.status()).toBe(422);
    const tiny = await owner.post('/media/remove-background', {
      multipart: { file: { name: 'icon.jpg', mimeType: 'image/jpeg', buffer: await photo(120, 120) } },
    });
    expect(tiny.status()).toBe(422);
    expect((await tiny.json()).message).toMatch(/at least 256 pixels/);
    expect(await kieCutouts(owner)).toBe(before);
  } finally {
    await owner.dispose();
  }
});
