import {
  languageRule,
  tooShortToDetectLanguage,
} from '@gitroom/nestjs-libraries/openai/language-rule';

describe('languageRule', () => {
  it('is phrased as "match the input", never as "avoid English"', () => {
    const rule = languageRule();
    expect(rule).toContain('English included');
    // A negative ("never assume English") reads as "avoid English" — a live
    // run turned an English prompt into French.
    expect(rule).not.toMatch(/never assume English|avoid English/i);
  });

  it('puts an explicit target first and detection second', () => {
    const rule = languageRule({
      targetNamedIn: 'the <settings> block of the user message',
      follow: "the user's prompt",
    });
    expect(rule.indexOf('target language')).toBeLessThan(
      rule.indexOf("the user's prompt")
    );
  });

  it('never mentions a fallback — the caller resolves that, not the model', () => {
    expect(languageRule()).not.toContain('fallback');
  });

  it('keeps the brand tone from deciding the language, when asked', () => {
    expect(languageRule({ ignoreBrandLanguage: true })).toContain(
      'brand constraints'
    );
    expect(languageRule()).not.toContain('brand constraints');
  });

  it('names what it governs, so it can be dropped into any prompt', () => {
    expect(languageRule({ scope: 'the caption', follow: 'the topic' })).toBe(
      'LANGUAGE: when writing the caption, match the language of the topic exactly: detect it from the text itself and answer in that language, English included. Never mix languages in one piece of output.'
    );
  });
});

describe('tooShortToDetectLanguage', () => {
  it('lets a real sentence speak for itself', () => {
    expect(
      tooShortToDetectLanguage('gym membership promo, two months at half price')
    ).toBe(false);
    expect(
      tooShortToDetectLanguage('promocja karnetu na siłownię, dwa miesiące')
    ).toBe(false);
  });

  it('calls a stub of a prompt undetectable', () => {
    expect(tooShortToDetectLanguage('fitness')).toBe(true);
    expect(tooShortToDetectLanguage('gym promo')).toBe(true);
    expect(tooShortToDetectLanguage('')).toBe(true);
    expect(tooShortToDetectLanguage(undefined)).toBe(true);
  });

  it('does not count punctuation, digits or emoji as language', () => {
    expect(tooShortToDetectLanguage('50% 2x 3 !!! 🎉 🏋️')).toBe(true);
  });
});
