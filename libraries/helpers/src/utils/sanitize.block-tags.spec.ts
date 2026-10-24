import { sanitizePostContent } from './sanitize.post.content';

// Upstream 14e5a4679 + 2ded21d14 (24 X 2026): a block tag the editor does
// not know was dropped with its text kept, so "Line one" and "Line two"
// from a <div> each came out as one line, through the API, MCP and pasted
// HTML alike.
describe('sanitizePostContent and unknown block tags', () => {
  it('turns unknown block tags into paragraphs instead of gluing their text', () => {
    expect(sanitizePostContent('<div>Line one</div><div>Line two</div>')).toBe(
      '<p>Line one</p><p>Line two</p>'
    );
    expect(
      sanitizePostContent(
        '<section class="x">a</section><blockquote>b</blockquote><pre>c</pre><h5>d</h5>'
      )
    ).toBe('<p>a</p><p>b</p><p>c</p><p>d</p>');
  });

  it('keeps what it allowed before', () => {
    expect(sanitizePostContent('<p>a</p><p><strong>b</strong></p>')).toBe(
      '<p>a</p><p><strong>b</strong></p>'
    );
    expect(sanitizePostContent('<script>x</script><p>ok</p>')).toBe(
      '<p>ok</p>'
    );
  });

  it('stays linear on an unclosed tag in a long body', () => {
    const body = '<div' + ' '.repeat(50_000) + 'x'.repeat(50_000);
    const started = Date.now();
    sanitizePostContent(body);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
