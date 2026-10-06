import { stripHtmlValidation } from './strip.html.validation';

describe('stripHtmlValidation entity unescaping', () => {
  it('decodes single-escaped entities', () => {
    expect(stripHtmlValidation('none', '&gt;')).toBe('>');
    expect(stripHtmlValidation('none', '&lt;b&gt;')).toBe('<b>');
    expect(stripHtmlValidation('none', 'a &amp; b')).toBe('a & b');
  });

  it('decodes double-escaped entities exactly once (no double unescaping)', () => {
    // "&amp;gt;" is the escaped form of the literal text "&gt;" — after one
    // decode it must stay "&gt;", not collapse to ">".
    expect(stripHtmlValidation('none', '&amp;gt;')).toBe('&gt;');
    expect(stripHtmlValidation('none', '&amp;lt;script&amp;gt;')).toBe(
      '&lt;script&gt;'
    );
    expect(stripHtmlValidation('none', '&amp;quot;')).toBe('&quot;');
  });

  it('keeps the same guarantee for the html branch', () => {
    expect(stripHtmlValidation('html', '&amp;gt;')).toBe('&gt;');
    expect(stripHtmlValidation('html', '&gt;')).toBe('>');
  });
});

// Posts from the public API or the agent can carry `<p class="…">`; they were
// taken for plain text and published with the tags and no line breaks
// (upstream 53ea9c8f, ec01d331, 08078373).
describe('stripHtmlValidation paragraphs with attributes', () => {
  it('turns attributed paragraphs into lines like plain ones', () => {
    const plain = stripHtmlValidation('normal', '<p>Hello</p><p>World</p>');
    expect(
      stripHtmlValidation('normal', '<p class="a">Hello</p><p dir="auto">World</p>')
    ).toBe(plain);
    expect(plain).not.toMatch(/<p/);
  });

  it('keeps markdown headings with attributes', () => {
    expect(
      stripHtmlValidation('markdown', '<h2 class="t">Title</h2><p class="b">Body</p>')
    ).toBe(stripHtmlValidation('markdown', '<h2>Title</h2><p>Body</p>'));
  });

  it('does not take <pre> for a paragraph', () => {
    expect(stripHtmlValidation('normal', '<pre>a  b</pre>')).toBe('<pre>a  b</pre>');
  });
});
