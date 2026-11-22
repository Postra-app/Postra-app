// The composer's previews show what the network will receive: the editor's
// HTML turned into the plain text that is sent (stripHtmlValidation), with the
// mention and the part over the channel's limit marked up for the preview.
//
// That text then went into the page as HTML, unescaped. A post that says
// "<b>sale</b> for Tom & Co" goes out with those characters in it, but the
// preview showed "sale for Tom & Co", and a typed "<img onerror=…>" was handed
// to the HTML parser. The text is escaped here; the only markup in the result
// is the markup written below.

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MENTION = /\[\[\[([.\s\S]*?)]]]/;

/**
 * @param source the post's content as stored (the editor's HTML)
 * @param text   what stripHtmlValidation made of it
 * @param start  \
 * @param end    / the part inside the channel's limit (textSlicer)
 */
export const previewHtml = (
  source: string,
  text: string,
  start: number,
  end: number
): string => {
  // Content with no paragraph in it (written through the API as a bare line)
  // comes back from stripHtmlValidation as it went in, still HTML: escaping it
  // would show its entities and tags as characters.
  const isText = /<p[\s>]/i.test(source || '');
  const part = (slice: string) =>
    (isText ? escapeHtml(slice) : slice).replace(
      MENTION,
      (_match, name) =>
        `<span class="font-bold font-[arial]" style="color: #ae8afc">${name}</span>`
    );

  return (
    part(text.slice(start, end)) +
    `<mark class="bg-red-500" data-tooltip-id="tooltip" data-tooltip-content="This text will be cropped">` +
    part(text.slice(end)) +
    `</mark>`
  );
};
