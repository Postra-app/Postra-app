/**
 * Which shape to ask the image model for.
 *
 * Until now the only choice was square or portrait, so a design for an X post
 * (16:9) or a LinkedIn banner got a square picture and lost a third of it to
 * the crop. Shared between the backend and Studio so both name the shapes the
 * same way.
 */
export type ImageOrientation = 'square' | 'portrait' | 'landscape';

const SIZES: Record<ImageOrientation, string> = {
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024',
};

/** The size string the images API expects. */
export const sizeForOrientation = (orientation: ImageOrientation): string =>
  SIZES[orientation] ?? SIZES.square;

/** Callers used to pass `isVertical: boolean`; keep understanding both so an
 *  older call site cannot silently ask for the wrong shape. */
export const normalizeOrientation = (
  value: ImageOrientation | boolean | undefined | null
): ImageOrientation => {
  if (value === true) return 'portrait';
  if (!value) return 'square';
  return value === 'portrait' || value === 'landscape' || value === 'square'
    ? value
    : 'square';
};

/** The orientation a canvas of this size wants. The thresholds are 6:5 and
 *  5:6, so LinkedIn's square and anything near it stays square, while IG Feed
 *  (4:5) asks for the portrait generation and is cropped down to fit. */
export const orientationForSize = (
  width: number,
  height: number
): ImageOrientation => {
  if (!width || !height) return 'square';
  const ratio = width / height;
  if (ratio >= 1.2) return 'landscape';
  if (ratio <= 0.833) return 'portrait';
  return 'square';
};
