import { readFileSync } from 'fs';
import { join } from 'path';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file.type';

// Every upload is checked by its first bytes. file-type below 21.3.1 has a
// published advisory (Dependabot #8, #61) and the bytes come from whoever
// uploads, so the version is held at or above the fix.
describe('file type from the first bytes', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  it('recognises a real image', async () => {
    await expect(fromBuffer(png)).resolves.toEqual({ ext: 'png', mime: 'image/png' });
  });

  it('does not take text named .jpg for an image', async () => {
    await expect(fromBuffer(Buffer.from('<script>alert(1)</script>'))).resolves.toBeUndefined();
  });

  it('recognises an mp4 by its ftyp box', async () => {
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from('isomiso2'),
    ]);
    await expect(fromBuffer(mp4)).resolves.toMatchObject({ mime: 'video/mp4' });
  });

  it('runs a version past the advisory', () => {
    const { version } = JSON.parse(
      readFileSync(join(require.resolve('file-type').split('/file-type/')[0], 'file-type', 'package.json'), 'utf8')
    );
    const [major, minor, patch] = version.split('.').map(Number);
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(21 * 1e6 + 3 * 1e3 + 1);
  });
});
