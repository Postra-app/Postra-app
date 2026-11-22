import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
import { previewHtml } from './preview.html';

// What the composer's preview puts on the page for a post, the way the
// previews do it: editor HTML -> the text that is sent -> preview markup ->
// the sanitiser.
const shown = (content: string, end = 10000) => {
  const text = stripHtmlValidation('normal', content, true);
  return sanitizePostContent(previewHtml(content, text, 0, Math.min(end, text.length)));
};
// what the editor stores when someone types these characters
const typed = (text: string) =>
  `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;

describe('the preview shows the characters the network will receive', () => {
  it('typed tags stay characters', () => {
    const html = shown(typed('<b>sale</b> for Tom & Co <i>today</i>'));
    expect(html).toContain('&lt;b&gt;sale&lt;/b&gt; for Tom &amp; Co &lt;i&gt;today&lt;/i&gt;');
    expect(html).not.toMatch(/<b>|<i>/);
  });

  it('a typed image with a handler never reaches the parser as an element', () => {
    const text = stripHtmlValidation('normal', typed('<img src=x onerror="alert(1)">'), true);
    const html = previewHtml(typed('x'), text, 0, text.length);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror="alert(1)"&gt;');
  });

  it('keeps line breaks and ordinary text as they were', () => {
    expect(shown('<p>one</p><p>two</p>')).toBe('one\ntwo');
  });

  it('marks up the mention, and the part over the limit', () => {
    const content = '<p>hi [[[@anna]]] and more</p>';
    const text = stripHtmlValidation('normal', content, true);
    const html = previewHtml(content, text, 0, 2);
    expect(html).toBe(
      'hi<mark class="bg-red-500" data-tooltip-id="tooltip" data-tooltip-content="This text will be cropped">' +
        ' <span class="font-bold font-[arial]" style="color: #ae8afc">@anna</span> and more</mark>'
    );
  });

  it('a bare line written through the API is left as it came', () => {
    // no paragraph: stripHtmlValidation hands the HTML back untouched
    expect(shown('Tom &amp; Co <strong>sale</strong>')).toBe('Tom &amp; Co <strong>sale</strong>');
  });
});
