/**
 * Reading and writing an object's box.
 *
 * Fabric stores a size as the source dimensions times a scale, so "make this
 * 400 wide" is a division, not an assignment — and a Textbox is the exception
 * that owns its width outright. Keeping the arithmetic here, away from the
 * canvas, is what makes it testable.
 */

export interface GeometrySource {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  flipX?: boolean;
  flipY?: boolean;
  rx?: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Whole pixels — a design tool that reports 199.99997 px looks broken. */
export const readBox = (o: GeometrySource): Box => ({
  left: Math.round(o.left ?? 0),
  top: Math.round(o.top ?? 0),
  width: Math.round((o.width ?? 0) * (o.scaleX ?? 1)),
  height: Math.round((o.height ?? 0) * (o.scaleY ?? 1)),
});

export const MIN_SIZE = 4;
export const MAX_SIZE = 10000;

export const clampSize = (value: number): number =>
  Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));

/** The scale that gives a source-sized object the width/height asked for.
 *  A zero or missing source dimension would divide by zero, so it keeps the
 *  scale it had. */
export const scaleForSize = (
  o: GeometrySource,
  width: number,
  height: number
): { scaleX: number; scaleY: number } => ({
  scaleX: o.width ? clampSize(width) / o.width : o.scaleX ?? 1,
  scaleY: o.height ? clampSize(height) / o.height : o.scaleY ?? 1,
});

/** Corner radius is stored per axis; the UI offers one number. */
export const cornerRadiusOf = (o: GeometrySource): number => Math.round(o.rx ?? 0);

/** Keep a radius inside what the shape can take: past half the shorter side a
 *  rectangle is a stadium and further values do nothing visible. */
export const clampCornerRadius = (radius: number, box: Box): number => {
  const limit = Math.floor(Math.min(box.width, box.height) / 2);
  return Math.min(Math.max(0, Math.round(radius)), Math.max(0, limit));
};
