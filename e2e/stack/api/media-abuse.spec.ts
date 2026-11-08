import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Uploads someone might use to fill our bucket or our memory: an image far
// past the image limit, and a "thumbnail" that is really a video (a thumbnail
// gets no library row, so nothing would ever count or list it).
const PNG_HEADER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
// ftyp box: enough for the magic-byte check to call it an MP4.
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from('isomiso2'),
  Buffer.alloc(1024),
]);

test('a 30 MB image and a video sent as a thumbnail are refused, and nothing is stored', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    const big = await org.api.post('/media/upload-simple', {
      multipart: { file: { name: 'big.png', mimeType: 'image/png', buffer: Buffer.concat([PNG_HEADER, Buffer.alloc(30 * 1024 * 1024)]) } },
    });
    expect(big.status(), await big.text()).toBe(400);
    expect(await big.text()).toContain('maximum allowed size');

    const video = await org.api.post('/media/upload-simple', {
      multipart: { file: { name: 'thumb.mp4', mimeType: 'video/mp4', buffer: MP4 }, preventSave: 'true' },
    });
    expect(video.status(), await video.text()).toBe(400);

    const image = await org.api.post('/media/upload-simple', {
      multipart: { file: { name: 'thumb.png', mimeType: 'image/png', buffer: PNG_HEADER }, preventSave: 'true' },
    });
    expect(image.status(), await image.text()).toBe(201);
    expect((await image.json()).path).toBeTruthy();

    expect(await prisma.media.count({ where: { organizationId: org.orgId } }), 'no library rows').toBe(0);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
