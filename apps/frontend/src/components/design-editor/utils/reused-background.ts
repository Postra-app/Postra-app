/**
 * Did this generation reuse a cached background instead of paying for a new
 * one? The backend reports it per design and per carousel slide; without
 * saying so in the UI the credit counter simply does not move, which reads
 * like the credit was lost.
 *
 * Measured on a live stack: the cache key is the MODEL-written image prompt,
 * not the user's prompt, and the model writes a fresh scene description every
 * time — so the same prompt typed twice usually misses. The notice is
 * therefore rare and must never claim a saving that did not happen: a carousel
 * counts only when EVERY slide came from cache.
 */
export const reusedBackground = (
  data: { cacheHit?: boolean; slides?: { cacheHit?: boolean }[] } | null,
  isCarousel: boolean
): boolean => {
  if (!data) return false;
  if (!isCarousel) return !!data.cacheHit;
  const slides = data.slides ?? [];
  return slides.length > 0 && slides.every((slide) => !!slide?.cacheHit);
};
