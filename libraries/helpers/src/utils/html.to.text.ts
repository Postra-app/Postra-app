import striptags from 'striptags';

const HIDDEN_BLOCKS = /<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const LINKS =
  /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
const LINE_BREAKS =
  /<br\s*\/?>|<\/(?:p|div|h[1-6]|li|tr|table|blockquote|section|header|footer|article|ul|ol)\s*>/gi;

/**
 * One pass leaves nested constructs behind: `<!--<!-- -->-->` loses the inner
 * comment and keeps the outer `-->`, and the same trick works on a style or
 * script block. Repeat until the string stops changing, which is also what
 * closes the incomplete-multi-character-sanitization finding on this file.
 */
const stripUntilStable = (input: string, pattern: RegExp): string => {
  let current = input;
  // A guard rather than a `while (true)`: each pass strictly shortens the
  // string, so this can only be reached by a pattern that does not.
  for (let pass = 0; pass < 10; pass++) {
    const next = current.replace(pattern, '');
    if (next === current) return next;
    current = next;
  }
  return current;
};

/**
 * Renders an HTML email body as readable plain text for the `text/plain`
 * alternative part.
 *
 * Reusing the HTML source as the plain-text part means every reader that
 * prefers plain text — the SES inbound forwarder, watch and notification
 * previews, text-only clients — shows raw markup instead of the message, and
 * the mismatch between the two parts is a spam-filter signal.
 */
export const htmlToText = (html: string): string => {
  const source = html || '';
  let withoutHidden = stripUntilStable(
    stripUntilStable(source, HIDDEN_BLOCKS),
    COMMENTS
  );

  // A comment inside a comment leaves the outer `-->` behind, because the
  // match is non-greedy and stops at the first close. Only clean up the
  // orphaned markers when this body actually had a comment in it - otherwise
  // an email that simply writes "click here --> now" loses its arrow.
  if (source.includes('<!--')) {
    withoutHidden = withoutHidden.split('-->').join('').split('<!--').join('');
  }

  const withLinks = withoutHidden
    // Keep the destination visible: a plain-text reader has no other way to
    // follow a link once the markup is gone.
    .replace(LINKS, (_match, doubleQuoted, singleQuoted, bare, label) => {
      const href = (doubleQuoted ?? singleQuoted ?? bare ?? '').trim();
      const text = striptags(label).replace(/\s+/g, ' ').trim();

      if (!href) {
        return text;
      }

      return !text || text === href ? href : `${text} (${href})`;
    });

  return (
    striptags(withLinks.replace(LINE_BREAKS, '\n'))
      // Unescape &amp; LAST: doing it first turns already-escaped text like
      // "&amp;lt;" into "&lt;" which the replaces below decode again (CodeQL
      // double-unescaping) — same ordering rule as stripHtmlValidation.
      .replace(/&nbsp;/gi, ' ')
      .replace(/&gt;/gi, '>')
      .replace(/&lt;/gi, '<')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
};
