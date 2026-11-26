import {
  keepBlankLinesOfPastedHtml,
  pasteAsPlainText,
} from './editor.paste';

describe('pasted html from a code editor', () => {
  it('keeps a blank line that is a div holding only a br', () => {
    expect(
      keepBlankLinesOfPastedHtml('<div>one</div><div><br></div><div>two</div>')
    ).toBe('<div>one</div><p></p><div>two</div>');
  });

  it('keeps a blank line that is a br between two line divs', () => {
    expect(
      keepBlankLinesOfPastedHtml('<div>one</div><br/><div>two</div>')
    ).toBe('<div>one</div><p></p><div>two</div>');
  });

  it('leaves a br inside a line alone', () => {
    const html = '<p>one<br>two</p>';
    expect(keepBlankLinesOfPastedHtml(html)).toBe(html);
  });
});

describe('paste whose html lost the line breaks', () => {
  const notion = {
    files: 0,
    html: '<meta charset="utf-8">First line\nSecond line\nThird line',
    text: 'First line\nSecond line\nThird line',
    blocks: 1,
    rich: false,
  };

  it('takes the plain text when the html is one unformatted block of several lines', () => {
    expect(pasteAsPlainText(notion)).toBe(true);
  });

  it('keeps the html when it has real paragraphs', () => {
    expect(pasteAsPlainText({ ...notion, blocks: 3 })).toBe(false);
  });

  it('keeps the html when it has formatting', () => {
    expect(pasteAsPlainText({ ...notion, rich: true })).toBe(false);
  });

  it('keeps a single line as it is', () => {
    expect(pasteAsPlainText({ ...notion, text: 'First line\n' })).toBe(false);
  });

  it('does nothing for a plain-text paste or a file', () => {
    expect(pasteAsPlainText({ ...notion, html: '' })).toBe(false);
    expect(pasteAsPlainText({ ...notion, files: 1 })).toBe(false);
  });
});
