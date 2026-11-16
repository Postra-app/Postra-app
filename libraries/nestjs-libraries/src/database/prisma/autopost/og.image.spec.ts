import { ogImageOf } from './og.image';

describe('the picture an article names', () => {
  it('reads og:image, either attribute order', () => {
    expect(ogImageOf('<head><meta property="og:image" content="https://a.example/x.jpg"></head>')).toBe(
      'https://a.example/x.jpg'
    );
    expect(ogImageOf("<meta content='https://a.example/y.jpg' property='og:image' />")).toBe(
      'https://a.example/y.jpg'
    );
  });

  it('falls back to twitter:image, and prefers og:image wherever it is', () => {
    const twitter = '<meta name="twitter:image" content="https://a.example/t.jpg">';
    expect(ogImageOf(twitter)).toBe('https://a.example/t.jpg');
    expect(ogImageOf(twitter + '<meta property="og:image" content="https://a.example/o.jpg">')).toBe(
      'https://a.example/o.jpg'
    );
  });

  it('finds nothing where there is nothing', () => {
    expect(ogImageOf('<html><body>no tags</body></html>')).toBeNull();
    expect(ogImageOf('<meta property="og:title" content="Title">')).toBeNull();
    expect(ogImageOf('')).toBeNull();
  });

  // The old pattern needed about ten minutes for each of these.
  it.each([
    ['repeated "<meta "', '<meta '.repeat(500_000)],
    ['one unclosed tag', '<meta ' + 'a'.repeat(3_000_000)],
    ['repeated attributes', '<meta ' + 'property="og:image" '.repeat(150_000)],
  ])('a 3 MB page of %s is answered at once', (_what, page) => {
    const started = Date.now();
    expect(ogImageOf(page)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
