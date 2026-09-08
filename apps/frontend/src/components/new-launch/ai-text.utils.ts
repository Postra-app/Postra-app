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

export const aiPlainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
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
