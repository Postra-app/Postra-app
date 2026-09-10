/**
 * One language rule for every AI surface.
 *
 * There used to be eight of them: Studio hard-coded Polish or English from the
 * UI locale, the ribbon said "keep the same language", the Creator said "use
 * simple english", AutoPost followed the article, and three prompts in
 * OpenaiService each wrote their own paragraph. A user writing in a fourth
 * language got a different answer from every one of them.
 *
 * The rule: an explicit target wins; otherwise follow the language of the
 * user's own words; never assume English.
 */

export interface LanguageRuleOptions {
  /** What the output covers, e.g. 'ALL text fields (headline, subtext, cta)'. */
  scope?: string;
  /** Where an explicit target language will be named, if the caller sends one. */
  targetNamedIn?: string;
  /** Whose language to copy when no target is named. */
  follow?: string;
  /**
   * Brand kits carry a tone written in one language and used for posts in
   * another — the tone must not decide the output language.
   */
  ignoreBrandLanguage?: boolean;
}

/**
 * Whether a prompt is too short for anyone — model or human — to tell what
 * language it is in. Measured, not asked: naming a fallback language in the
 * prompt and trusting the model to use it "only if unclear" does not work.
 * Live check: an eight-word English prompt with "Fallback language: Polish"
 * came back in Polish. So the caller decides, and the model only ever sees a
 * target it must obey.
 */
export function tooShortToDetectLanguage(text?: string | null): boolean {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = (text ?? '').replace(/[^\p{L}]/gu, '').length;
  return words.length < 3 || letters < 12;
}

export function languageRule(options: LanguageRuleOptions = {}): string {
  const {
    scope = 'the result',
    targetNamedIn,
    follow = "the user's own text",
    ignoreBrandLanguage,
  } = options;

  // "Never assume English" reads as "avoid English": an English prompt with
  // that wording and no target came back in FRENCH on a live run. The rule
  // has to be positive — match the input, English included.
  const match = `match the language of ${follow} exactly: detect it from the text itself and answer in that language, English included`;

  const sentences = [
    targetNamedIn
      ? `LANGUAGE: write ${scope} in the target language named in ${targetNamedIn}. When no target is given, ${match}.`
      : `LANGUAGE: when writing ${scope}, ${match}.`,
    'Never mix languages in one piece of output.',
    ignoreBrandLanguage &&
      'The language of the brand constraints never decides the output language.',
  ];

  return sentences.filter(Boolean).join(' ');
}
