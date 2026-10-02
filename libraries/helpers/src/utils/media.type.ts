// One place that decides whether a stored asset is a video.
//
// `Media.type` was a dead column for the whole life of the product: every row
// said `image`, including the `.mp4` ones, because `saveFile` never set it. The
// library and the video picker worked around that by looking for "mp4" inside
// the path, which reads the wrong thing (a filename, not a type) and cannot be
// used in SQL - so the video tab filtered the current page of 18 rows instead
// of the library.
//
// `saveFile` now records the type, and readers go through `isVideoMedia`, which
// still falls back to the path. The fallback is what makes the rollout safe in
// either order: rows written before the backfill keep resolving correctly.
// Matched against the path with any query string cut off first: an optional
// `(\?.*)?` group here backtracked polynomially on crafted paths (CodeQL #69).
const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|mkv|avi|qt|ogv)$/i;

export type MediaType = 'image' | 'video';

export const mediaTypeFromPath = (
  path: string | undefined | null
): MediaType =>
  path && VIDEO_EXTENSION.test(path.split('?')[0]) ? 'video' : 'image';

export const isVideoMedia = (
  media: { type?: string | null; path?: string | null } | undefined | null
): boolean => {
  if (!media) {
    return false;
  }
  if (media.type === 'video') {
    return true;
  }
  // Written before the backfill: the column says `image` for everything, so it
  // carries no signal and the path decides.
  return mediaTypeFromPath(media.path) === 'video';
};
