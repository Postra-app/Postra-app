// Decisions about pasted content, kept apart from the editor so they can be
// tested without a browser.

/**
 * A blank line copied from a code editor is a <br> between two line <div>s,
 * or a <div> holding only a <br>. Left as it is, the paste loses the blank
 * line; each one becomes an empty paragraph (upstream bd6d6e1f9).
 */
export const keepBlankLinesOfPastedHtml = (html: string) =>
  html
    .replace(/<div[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, '<p></p>')
    .replace(/(<\/div>)\s*<br\s*\/?>\s*(?=<div)/gi, '$1<p></p>');

export interface PastedContent {
  /** Files on the clipboard (an image paste is handled elsewhere). */
  files: number;
  /** The clipboard's text/html, empty when it has none. */
  html: string;
  /** The clipboard's text/plain. */
  text: string;
  /** Text blocks (paragraphs, headings) the editor parsed from the html. */
  blocks: number;
  /** The parsed html has formatting or something other than text. */
  rich: boolean;
}

/**
 * Some apps (Notion's copy button) put the text into the clipboard html with
 * bare newlines and no tags, so it parses as one paragraph and every line is
 * merged. When the html gives a single unformatted block but the plain text
 * has several lines, the plain text is what the person copied
 * (upstream 72b9d84ae).
 */
export const pasteAsPlainText = (pasted: PastedContent) =>
  !pasted.files &&
  !!pasted.html &&
  pasted.blocks <= 1 &&
  !pasted.rich &&
  pasted.text.split(/\r\n?|\n/).filter((line) => line.trim()).length > 1;
