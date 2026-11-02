import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalStorage } from '@gitroom/nestjs-libraries/upload/local.storage';

// Upstream 12db9bd2f: the cleanups pass the public URL a media row stores,
// which went to unlink as it was (nothing was ever deleted), and a stored
// path could point anywhere on the disk.
describe('LocalStorage.removeFile', () => {
  const root = mkdtempSync(join(tmpdir(), 'postra-uploads-'));
  const outside = mkdtempSync(join(tmpdir(), 'postra-outside-'));
  const storage = new LocalStorage(root);
  const frontend = process.env.FRONTEND_URL;
  beforeAll(() => (process.env.FRONTEND_URL = 'https://app.example.test'));
  afterAll(() => (process.env.FRONTEND_URL = frontend));

  const file = (dir: string, name: string) => {
    mkdirSync(join(dir, '2026/11/02'), { recursive: true });
    const path = join(dir, '2026/11/02', name);
    writeFileSync(path, 'x');
    return path;
  };

  it('deletes the file behind the public URL', async () => {
    const path = file(root, 'a.png');
    await storage.removeFile('https://app.example.test/uploads/2026/11/02/a.png');
    expect(existsSync(path)).toBe(false);
  });

  it('deletes a path inside the upload directory', async () => {
    const path = file(root, 'b.png');
    await storage.removeFile(path);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses anything outside it, `..` included', async () => {
    const path = file(outside, 'c.png');
    await expect(storage.removeFile(path)).rejects.toThrow('Unsafe file path');
    await expect(
      storage.removeFile(`https://app.example.test/uploads/../${outside.split('/').pop()}/2026/11/02/c.png`)
    ).rejects.toThrow('Unsafe file path');
    await expect(storage.removeFile(root)).rejects.toThrow('Unsafe file path');
    expect(existsSync(path)).toBe(true);
  });
});
