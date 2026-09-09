import { htmlToText } from './html.to.text';

describe('htmlToText', () => {
  it('drops style blocks instead of dumping CSS into the text part', () => {
    const html = `
      <div style="background: linear-gradient(to bottom right, #e6f2ff, #f0e6ff);">
        <style>.mb_hide { display: none !important }</style>
        <h1 style="font-size: 1.875rem;">Streak Reminder</h1>
        <p>You are about to lose your streak in two hours!</p>
      </div>`;

    expect(htmlToText(html)).toBe(
      'Streak Reminder\n\nYou are about to lose your streak in two hours!'
    );
  });

  it('keeps link targets so a plain-text reader can still follow them', () => {
    expect(
      htmlToText('<a href="https://app.postra.pl/settings">account settings</a>')
    ).toBe('account settings (https://app.postra.pl/settings)');
  });

  it('does not repeat the url when the label is already the url', () => {
    expect(htmlToText('<a href="https://postra.co.uk">https://postra.co.uk</a>')).toBe(
      'https://postra.co.uk'
    );
  });

  it('unescapes &amp; last so escaped entities are not decoded twice', () => {
    expect(htmlToText('<p>&amp;lt;script&amp;gt; &amp; &quot;quotes&quot;</p>')).toBe(
      '&lt;script&gt; & "quotes"'
    );
  });

  it('collapses the whitespace an html template leaves behind', () => {
    expect(htmlToText('<p>one</p>\n\n\n   <p>two</p><br><br><br><p>three</p>')).toBe(
      'one\n\ntwo\n\nthree'
    );
  });

  it('survives empty input', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText(undefined as unknown as string)).toBe('');
  });
});

describe('htmlToText — nested markup', () => {
  it('removes a comment hidden inside another comment', () => {
    const out = htmlToText('<p>Hello<!--<!-- hidden -->--> there</p>');
    expect(out).not.toContain('-->');
    expect(out).not.toContain('hidden');
    expect(out).toContain('Hello');
  });

  it('removes a style block that was split by another style tag', () => {
    const out = htmlToText(
      '<p>Before<sty<style>x</style>le>body{color:red}</style>After</p>'
    );
    expect(out).not.toMatch(/color:red/);
    expect(out).toContain('Before');
  });

  it('still returns the visible text of an ordinary email', () => {
    const out = htmlToText(
      '<html><head><title>t</title></head><body><p>Hi <a href="https://postra.co.uk">Postra</a></p></body></html>'
    );
    expect(out).toContain('Hi Postra (https://postra.co.uk)');
    expect(out).not.toContain('<');
  });
});
