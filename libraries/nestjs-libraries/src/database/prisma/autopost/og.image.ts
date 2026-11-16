// The picture an article names for itself (og:image, then twitter:image).
// The page is someone else's and up to 3 MB. The pattern this replaces let
// "[^>]*" run from every "<meta" to the end of the text: on a page of
// repeated "<meta " the search took minutes of one CPU (15 s at 480 KB,
// measured), in the worker that publishes for everyone, again at every
// hourly run of the feed. Tags are bounded here, and only the start of the
// page is read: the tags sit in <head>.
const HEAD_BYTES = 300_000;
const META_TAG = /<meta\b[^<>]{0,2000}>/gi;
const attribute = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"'<>]{1,2000})["']`, 'i').exec(tag)?.[1];

export const ogImageOf = (html: string): string | null => {
  const head = html.slice(0, HEAD_BYTES);
  let twitter: string | null = null;
  for (const [tag] of head.matchAll(META_TAG)) {
    const content = attribute(tag, 'content');
    if (!content) continue;
    if (attribute(tag, 'property')?.toLowerCase() === 'og:image') {
      return content;
    }
    if (!twitter && attribute(tag, 'name')?.toLowerCase() === 'twitter:image') {
      twitter = content;
    }
  }
  return twitter;
};
