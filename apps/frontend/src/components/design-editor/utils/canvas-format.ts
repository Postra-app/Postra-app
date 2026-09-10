import { PLATFORM_SIZES, PlatformSize } from '../editor.store';

/**
 * Which format a design was drawn for.
 *
 * Fabric serialises objects and their coordinates, never the size of the frame
 * they were placed in. So a design saved as an X post (1600×900) reopened while
 * the editor happens to be on IG Feed (1080×1350) is drawn at the wrong size,
 * and Undo across a format switch restored old coordinates onto the new frame.
 * Both are fixed by writing the format alongside the objects: Fabric ignores
 * keys it does not know, so this needs no migration and no new column.
 */
export const PLATFORM_STAMP_KEY = 'postraPlatform';

const isPlatform = (value: unknown): value is PlatformSize => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.key === 'string' &&
    typeof p.label === 'string' &&
    typeof p.width === 'number' &&
    typeof p.height === 'number' &&
    p.width > 0 &&
    p.height > 0
  );
};

/** Add the format to a serialised canvas. Returns the input untouched if it is
 *  not JSON we can extend — a stamp is never worth losing a design over. */
export const stampPlatform = (canvasJson: string, platform: PlatformSize): string => {
  try {
    const parsed = JSON.parse(canvasJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return canvasJson;
    return JSON.stringify({ ...parsed, [PLATFORM_STAMP_KEY]: { ...platform } });
  } catch {
    return canvasJson;
  }
};

/** The format a canvas was drawn for, or null for designs saved before the
 *  stamp existed (they open in whatever format is current, as they always did). */
export const readStampedPlatform = (canvasJson: string | null | undefined): PlatformSize | null => {
  if (!canvasJson) return null;
  try {
    const parsed = JSON.parse(canvasJson);
    const stamped = (parsed as Record<string, unknown>)?.[PLATFORM_STAMP_KEY];
    if (!isPlatform(stamped)) return null;
    // Take the dimensions from the stamp, not from the catalogue: a format's
    // pixel size could change, and the design was drawn for the old one.
    return {
      key: stamped.key,
      label: stamped.label,
      width: stamped.width,
      height: stamped.height,
    };
  } catch {
    return null;
  }
};

/** The catalogue entry matching a size, so a stamped custom size still shows a
 *  recognisable name in the format bar. */
export const platformBySize = (width: number, height: number): PlatformSize | null =>
  PLATFORM_SIZES.find(
    (p) => p.key !== 'custom' && p.width === width && p.height === height
  ) ?? null;

/** Do two formats describe the same drawing surface? */
export const sameSurface = (a: PlatformSize, b: PlatformSize): boolean =>
  a.width === b.width && a.height === b.height;
