import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

// A line break inside a paragraph (<br>, what the API, an assistant or a
// pasted text may send) is a new line in the published post. It used to be
// removed, joining the two lines into one word, or published as the text
// "<br>".
describe('a <br> in a post', () => {
  it('is a new line on a plain-text platform', () => {
    expect(stripHtmlValidation('normal', '<p>Hello<br>World</p>', true)).toBe('Hello\nWorld');
    expect(stripHtmlValidation('normal', '<p>Hello<br />World</p><p>Next</p>', true)).toBe('Hello\nWorld\nNext');
  });

  it('is a new line when the text has no paragraph at all', () => {
    const out = stripHtmlValidation('normal', 'Hello<br>World', true);
    expect(out).not.toContain('<br');
    expect(out).toBe('Hello\nWorld');
  });

  it('keeps bold on both lines', () => {
    const out = stripHtmlValidation('normal', '<p><strong>ab<br>cd</strong></p>', true);
    expect(out).toBe('𝗮𝗯\n𝗰𝗱');
  });

  it('is a space inside a list item, which is one line', () => {
    const out = stripHtmlValidation('normal', '<ul><li><p>one<br>two</p></li></ul>', true);
    expect(out).toContain('- one two');
  });

  it('is a new line in markdown and when every tag is removed', () => {
    expect(stripHtmlValidation('markdown', '<p>Hello<br>World</p>')).toContain('Hello\nWorld');
    expect(stripHtmlValidation('none', '<p>Hello<br>World</p>')).toBe('Hello\nWorld');
  });

  it('stays a <br> on a platform that takes HTML', () => {
    expect(stripHtmlValidation('html', '<p>Hello<br>World</p>')).toBe('<p>Hello<br>World</p>');
  });
});
