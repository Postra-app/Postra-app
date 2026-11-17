import { aiPlainText, aiTextToHtml, selectAdaptTargets } from './ai-text.utils';

describe('aiTextToHtml', () => {
  it('wraps every line in its own paragraph', () => {
    expect(aiTextToHtml('one\ntwo')).toBe('<p>one</p><p>two</p>');
  });

  it('keeps an empty line visible instead of collapsing it', () => {
    expect(aiTextToHtml('a\n\nb')).toBe('<p>a</p><p><br></p><p>b</p>');
  });

  it('escapes markup so a model answer cannot inject tags', () => {
    expect(aiTextToHtml('<b>hi</b> & bye')).toBe(
      '<p>&lt;b&gt;hi&lt;/b&gt; &amp; bye</p>'
    );
  });
});

describe('aiPlainText', () => {
  it('strips tags and squeezes whitespace, a line per paragraph', () => {
    expect(aiPlainText('<p>hello </p>\n<p>  world</p>')).toBe('hello\nworld');
  });

  // "Tom &amp; Co" went to the model escaped and on one line.
  it('sends the characters, not their HTML escapes', () => {
    expect(aiPlainText('<p>Tom &amp; Co makes &lt;great&gt; coffee</p>')).toBe(
      'Tom & Co makes <great> coffee'
    );
  });

  it('keeps paragraphs and an empty line between them', () => {
    expect(aiPlainText('<p>First paragraph.</p><p><br></p><p>Second paragraph.</p>')).toBe(
      'First paragraph.\n\nSecond paragraph.'
    );
  });

  it('leaves a typed "&lt;" as it was typed', () => {
    expect(aiPlainText('<p>write &amp;lt; in HTML</p>')).toBe('write &lt; in HTML');
  });

  it('round-trips through aiTextToHtml without doubling escapes', () => {
    const html = aiTextToHtml(aiPlainText('<p>Tom &amp; Co</p><p>Line two</p>'));
    expect(html).toBe('<p>Tom &amp; Co</p><p>Line two</p>');
  });
});

describe('selectAdaptTargets', () => {
  const a = { integration: { id: 'a' } };
  const b = { integration: { id: 'b' } };
  const c = { integration: { id: 'c' } };

  it('returns every channel when none was customised', () => {
    expect(selectAdaptTargets([a, b], [])).toEqual([a, b]);
  });

  it('drops channels that already have their own version', () => {
    expect(selectAdaptTargets([a, b, c], [b])).toEqual([a, c]);
  });

  it('returns nothing when every channel was customised', () => {
    expect(selectAdaptTargets([a, b], [a, b])).toEqual([]);
  });
});

describe('aiPlainText strips nested tags completely', () => {
  it('leaves no tag behind a broken one', () => {
    expect(aiPlainText('<p>a<scr<b>ipt>b</p>')).not.toMatch(/<script/i);
  });
});
