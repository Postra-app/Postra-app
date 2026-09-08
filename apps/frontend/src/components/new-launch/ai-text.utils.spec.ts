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
  it('strips tags and squeezes whitespace', () => {
    expect(aiPlainText('<p>hello </p>\n<p>  world</p>')).toBe('hello world');
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
