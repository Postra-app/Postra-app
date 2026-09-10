/**
 * The exact string the template embeddings are keyed by.
 *
 * Studio's template catalogue lives in the frontend bundle, so the server only
 * learns the texts because the client sends them - about 3KB on every
 * keystroke-debounced search, for a corpus that changes only when we ship a new
 * template. Both sides build the corpus here so the client can send a hash
 * instead, and only fall back to the full payload when the server has nothing
 * cached under it.
 */
export interface TemplateCorpusEntry {
  id: string;
  text: string;
}

export const templateCorpus = (entries: TemplateCorpusEntry[]): string =>
  entries
    // Unit separator, not NUL: a raw NUL byte in a source file made grep treat
    // the whole file as binary and skip it without saying so.
    .map((t) => `${t.id}\u001f${t.text}`)
    .sort()
    .join('|');
