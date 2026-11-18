/**
 * Credits to add to a post's text for the media just put into it.
 *
 * A stock photo library may ask for its photographer to be credited in the
 * text of a social post that uses the photo (Unsplash does: "Photo by <name>
 * on Unsplash", with their handle). A library file carries that line in
 * `credit`; when such a file goes into a post, the line is added once. A line
 * already in the text (typed, or added before) is not added again.
 */
export const creditsToAdd = (
  media: readonly object[] | undefined,
  text: string
): string[] => {
  const out: string[] = [];
  for (const m of media || []) {
    const value = (m as { credit?: unknown } | null)?.credit;
    // A Studio design with two stock photos carries two lines.
    for (const line of typeof value === 'string' ? value.split('\n') : []) {
      const credit = line.trim();
      if (!credit || text.includes(credit) || out.includes(credit)) continue;
      out.push(credit);
    }
  }
  return out;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The same lines as paragraphs, for a post opened with media already in it. */
export const creditsAsHtml = (media: readonly object[] | undefined) =>
  creditsToAdd(media, '')
    .map((c) => `<p>${escapeHtml(c)}</p>`)
    .join('');
