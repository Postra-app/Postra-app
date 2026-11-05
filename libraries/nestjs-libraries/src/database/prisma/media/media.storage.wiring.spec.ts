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
