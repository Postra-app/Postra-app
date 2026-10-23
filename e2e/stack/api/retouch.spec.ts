import { APIRequestContext, expect, test } from '@playwright/test';
import { readFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { database, throwawayOrg } from '../helpers';

// Photo retouch (Plan/photo-retouch.md): a library photo in, a new library
// photo out, the source untouched. The fake OpenAI answers the vision call
// with a spec of all ones (instanceOf: every number is 1), which the level
// caps; when OpenAI is down the heuristic decides and the photo still comes
// back. No credit is spent, the decision is metered as engine "retouch".

const FAKE = 'http://localhost:58090';
const UPLOADS = process.env.UPLOAD_DIRECTORY || '/tmp/postra-e2e-stack-uploads';
const prisma = database();
let org: Awaited<ReturnType<typeof throwawayOrg>>;
let other: Awaited<ReturnType<typeof throwawayOrg>>;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  other = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
});
test.afterAll(async () => {
  await org.remove();
  await other.remove();
  await prisma.$disconnect();
});

// A photo-like JPEG: a dim, blue-tinted gradient, so every level has
// something to correct and black and white has colour to drop.
const photo = async () => {
  const w = 320;
  const h = 240;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const v = 10 + Math.round((x / (w - 1)) * 150);
      raw[i] = Math.round(v * 0.8);
      raw[i + 1] = v;
      raw[i + 2] = Math.min(255, Math.round(v * 1.25));
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
};

const upload = async (api: APIRequestContext, name: string, buffer: Buffer, mimeType = 'image/jpeg') => {
  const res = await api.post('/media/upload-simple', { multipart: { file: { name, mimeType, buffer } } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; path: string };
};

const bytesOf = (path: string) => readFile(join(UPLOADS, path.split('/uploads/')[1]));
const means = async (buf: Buffer) => (await sharp(buf).stats()).channels.slice(0, 3).map((c) => c.mean);
const usageRows = () => prisma.aiUsage.findMany({ where: { organizationId: org.orgId, engine: 'retouch' } });
const imagesLeft = async () =>
  (await (await org.api.get('/copilot/credits?type=ai_images')).json()).credits as number;

test('a light retouch makes a new library photo, keeps the source and costs no credit', async () => {
  const credits = await imagesLeft();
  const source = await upload(org.api, 'team-photo.jpg', await photo());

  const res = await org.api.post(`/media/${source.id}/retouch`, { data: { level: 'light' } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  expect(body.id).not.toBe(source.id);
  expect(body.sourceId).toBe(source.id);
  expect(body.level).toBe('light');
  expect(body.fallback).toBe(false);
  expect(typeof body.summary).toBe('string');
  expect(body.summary.length).toBeGreaterThan(0);
  expect(body.originalName).toBe('team-photo (retouched, light).jpg');
  expect([body.width, body.height]).toEqual([320, 240]);

  const made = await prisma.media.findUniqueOrThrow({ where: { id: body.id } });
  expect(made).toMatchObject({
    organizationId: org.orgId,
    retouchSourceId: source.id,
    retouchLevel: 'light',
    aiGenerated: false,
  });
  expect(made.retouchSpec).toMatchObject({ summary: body.summary });
  const untouched = await prisma.media.findUniqueOrThrow({ where: { id: source.id } });
  expect(untouched.retouchSpec).toBeNull();
  expect(untouched.deletedAt).toBeNull();

  // the pixels moved: a dim photo with the model asking for +1 on everything
  // comes back brighter and warmer, within the light reach
  const before = await means(await bytesOf(source.path));
  const after = await means(await bytesOf(made.path));
  expect(after[1]).toBeGreaterThan(before[1]);
  expect(after[0] / after[2]).toBeGreaterThan(before[0] / before[2]);

  expect(await imagesLeft()).toBe(credits);
  const usage = await usageRows();
  expect(usage).toHaveLength(1);
  expect(usage[0].model).toBe('gpt-4.1-mini');
});

test('black and white comes back grey, and a redo at another level reuses the decision', async () => {
  const source = await upload(org.api, 'street.jpg', await photo());
  const bw = await (await org.api.post(`/media/${source.id}/retouch`, { data: { level: 'bw' } })).json();
  const [r, g, b] = await means(await bytesOf(bw.path));
  expect(Math.abs(r - g)).toBeLessThan(1);
  expect(Math.abs(g - b)).toBeLessThan(1);
  expect(bw.originalName).toBe('street (retouched, black and white).jpg');

  const rows = (await usageRows()).length;
  const redo = await org.api.post(`/media/${bw.id}/retouch`, { data: { level: 'strong' } });
  expect(redo.status(), await redo.text()).toBe(201);
  const strong = await redo.json();
  // the chain points at the untouched original, not at the black and white file
  expect(strong.sourceId).toBe(source.id);
  expect(strong.originalName).toBe('street (retouched, strong).jpg');
  expect((await usageRows()).length).toBe(rows);
});

test('a GIF, a missing level and another organisation\'s photo are refused', async () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=', 'base64');
  const animated = await upload(org.api, 'loop.gif', gif, 'image/gif');
  const res = await org.api.post(`/media/${animated.id}/retouch`, { data: { level: 'medium' } });
  expect(res.status()).toBe(422);
  expect((await res.json()).message).toMatch(/JPEG, PNG and WebP/);

  const source = await upload(org.api, 'mine.jpg', await photo());
  expect((await org.api.post(`/media/${source.id}/retouch`, { data: { level: 'sepia' } })).status()).toBe(400);
  expect((await other.api.post(`/media/${source.id}/retouch`, { data: { level: 'light' } })).status()).toBe(404);
});

test('with OpenAI down the heuristic decides and the photo still comes back', async () => {
  const marker = 'stack-openai-outage-retouch';
  await org.api.post(`${FAKE}/__outage`, { data: { match: marker, on: true } });
  try {
    const source = await upload(org.api, `${marker}.jpg`, await photo());
    const rows = (await usageRows()).length;
    const res = await org.api.post(`/media/${source.id}/retouch`, { data: { level: 'medium' } });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body.fallback).toBe(true);
    expect(body.summary).toMatch(/AI was not available/);
    expect((await usageRows()).length).toBe(rows);
    const after = await means(await bytesOf(body.path));
    const before = await means(await bytesOf(source.path));
    expect(after[1]).toBeGreaterThan(before[1]);
  } finally {
    await org.api.post(`${FAKE}/__outage`, { data: { match: marker, on: false } });
  }
});
