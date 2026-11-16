import { sanitizePostContent } from './sanitize.post.content';

// The preview of a post is public and on the app's own address. Content sent
// through the API or pasted as HTML kept any class and any "//host" link, so
// the app's own utility classes turned a link into a full-screen page.
describe('sanitizePostContent on a public page', () => {
  it('drops classes the editor does not write', () => {
    const out = sanitizePostContent(
      '<p><a href="https://evil.example" class="fixed top-0 start-0 w-full h-full z-[900] bg-black">Session expired - sign in again</a></p>'
    );
    expect(out).not.toContain('class=');
    expect(out).toBe('<p><a href="https://evil.example">Session expired - sign in again</a></p>');
  });

  it('keeps the class of a mention, and only that one', () => {
    expect(
      sanitizePostContent(
        '<p><span class="mention fixed" data-mention-id="1" data-mention-label="Ann">@Ann</span></p>'
      )
    ).toBe('<p><span class="mention" data-mention-id="1" data-mention-label="Ann">@Ann</span></p>');
  });

  it.each(['//evil.example/login', '/\\evil.example/login', '/\t/evil.example'])(
    'does not take %j for a path on this site',
    (href) => {
      expect(sanitizePostContent(`<a href="${href}">x</a>`)).not.toContain('evil.example');
    }
  );

  it('keeps real links', () => {
    for (const href of ['https://example.com/a?b=1', '/launches', '#top', 'mailto:hello@example.com']) {
      expect(sanitizePostContent(`<a href="${href}">x</a>`)).toBe(`<a href="${href}">x</a>`);
    }
  });
});
