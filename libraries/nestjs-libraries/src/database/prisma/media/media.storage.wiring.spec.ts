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

// Studio's Remove background: the library is checked before kie.ai is
// asked, and again at the size of the cut-out that is actually kept (often
// larger than the JPEG it came from); over the limit, nothing is kept.
describe('remove background checks storage at the size it keeps', () => {
  const start = source.indexOf('  async removeBackground(');
  const body = source.slice(start, source.indexOf('\n  async ', start + 10));

  it('before asking kie.ai', () => {
    expect(body.indexOf('await this.assertStorage(org.id, 0);')).toBeGreaterThan(-1);
    expect(body.indexOf('await this.assertStorage(org.id, 0);')).toBeLessThan(
      body.indexOf('await removeBackground(')
    );
  });

  it('with the cut-out size, removing the file when the library is full', () => {
    const check = body.indexOf('await this.assertStorage(org.id, size);');
    expect(check).toBeGreaterThan(body.indexOf('await removeBackground('));
    expect(check).toBeLessThan(body.indexOf('this.saveFile('));
    expect(body.slice(check)).toMatch(/catch \(err\) \{[\s\S]*removeFile\(uploaded\)/);
  });

  it('removes the input it uploaded for kie.ai to read', () => {
    expect(body).toMatch(/removeFile\(inputUrl\)/);
  });
});

