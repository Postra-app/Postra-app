// The AI answers in plain text, the editor stores <p>-per-line HTML.
// Shared by the per-post ribbon and by "adapt to each channel", so the two
// cannot drift into producing different markup for the same answer.
export const aiTextToHtml = (text: string) =>
  text
    .split('\n')
    .map((line) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<p>${escaped || '<br>'}</p>`;
    })
    .join('');

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// &amp; last, so "&amp;lt;" (a literal "&lt;" typed by the customer) stays
// "&lt;" instead of turning into "<".
const decodeEntities = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/&amp;/g, '&');

// The editor's HTML as the text the AI should read: one line per paragraph,
// and the characters themselves rather than their HTML escapes. It sent
// "Tom &amp; Co" on one line; a model that echoed it back put a literal
// "&amp;amp;" in the post, and every paragraph break was gone.
export const aiPlainText = (html: string) =>
  decodeEntities(
    html
      // A raw line break in HTML is only whitespace; the tags say where
      // lines end.
      .replace(/\r?\n/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Below this an "improve"/"adapt" call has nothing to work with.
export const AI_MIN_CONTENT_LEN = 10;

// A channel that already carries its own version holds text the user typed by
// hand. "Adapt to each channel" must never overwrite it, so those channels are
// dropped here rather than inside the request loop.
export const selectAdaptTargets = <T extends { integration: { id: string } }>(
  selected: T[],
  alreadyCustomised: { integration: { id: string } }[]
): T[] => {
  const skip = new Set(alreadyCustomised.map((i) => i.integration.id));
  return selected.filter((s) => !skip.has(s.integration.id));
};
