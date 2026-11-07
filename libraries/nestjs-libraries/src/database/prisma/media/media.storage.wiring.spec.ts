import { readFileSync } from 'fs';
import { join } from 'path';

// MediaService cannot be started in a unit test (it pulls the subscription
// and integration managers in), so the wiring is read from the source: every
// path that makes a new library file with AI or a retouch checks the media
// storage first, before any credit or model time is spent.
const source = readFileSync(join(__dirname, 'media.service.ts'), 'utf8');

describe('media storage is checked before generating', () => {
  it.each([
    'generateImage',
    'generatePostDesign',
    'createBrandedDraft',
    'generatePostCarousel',
    'generateVideo',
    'retouch',
  ])('%s', (method) => {
    const start = source.indexOf(`  async ${method}(`);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 1200);
    const firstBrace = body.indexOf(') {');
    expect(body.slice(firstBrace, firstBrace + 260)).toContain('await this.assertStorage(org.id, 0);');
  });
});

// Studio's Remove background: the library is checked before Photoroom is
// asked, and again at the size of the PNG that is actually kept (larger than
// the JPEG it came from), before it is uploaded.
describe('remove background checks storage at the size it keeps', () => {
  const start = source.indexOf('  async removeBackground(');
  const body = source.slice(start, source.indexOf('\n  async ', start + 10));

  it('before asking Photoroom', () => {
    expect(body.indexOf('await this.assertStorage(org.id, 0);')).toBeGreaterThan(-1);
    expect(body.indexOf('await this.assertStorage(org.id, 0);')).toBeLessThan(
      body.indexOf('await removeBackground(')
    );
  });

  it('with the PNG size, before uploading it', () => {
    const check = body.indexOf('await this.assertStorage(org.id, png.length);');
    expect(check).toBeGreaterThan(body.indexOf('await removeBackground('));
    expect(check).toBeLessThan(body.indexOf('this.storage.uploadSimple('));
  });
});

