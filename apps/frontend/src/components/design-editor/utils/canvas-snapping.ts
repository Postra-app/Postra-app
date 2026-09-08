/**
 * Alignment guides and snapping for the Studio canvas.
 *
 * Fabric ships this as an extension, but its published entry point re-exports
 * the gesture helpers, which import `westures` - a peer we do not install - so
 * the whole barrel evaluates to nothing in the browser, and the package's
 * `exports` map blocks reaching past it. Rather than add a dependency for a
 * feature we never use, the maths lives here: it is small, and unit-testable
 * without a canvas.
 */

export type SnapEdges = {
  left: number;
  centreX: number;
  right: number;
  top: number;
  centreY: number;
  bottom: number;
};

export type SnapGuide =
  | { axis: 'x'; at: number }
  | { axis: 'y'; at: number };

export type SnapResult = {
  /** How far to move the object, in canvas units. */
  dx: number;
  dy: number;
  /** Lines to draw while the object is held near an alignment. */
  guides: SnapGuide[];
};

export const edgesOf = (
  left: number,
  top: number,
  width: number,
  height: number
): SnapEdges => ({
  left,
  centreX: left + width / 2,
  right: left + width,
  top,
  centreY: top + height / 2,
  bottom: top + height,
});

/**
 * Compare the moving object's three vertical and three horizontal lines against
 * everything else on the canvas plus the artboard itself, and return the
 * smallest nudge that lines them up.
 *
 * `threshold` is in canvas units, so callers divide their pixel tolerance by
 * the zoom - otherwise snapping gets stickier the further you zoom out.
 */
export const computeSnap = (
  moving: SnapEdges,
  others: SnapEdges[],
  artboard: { width: number; height: number },
  threshold: number
): SnapResult => {
  const artboardEdges = edgesOf(0, 0, artboard.width, artboard.height);
  const targets = [...others, artboardEdges];

  const movingX = [moving.left, moving.centreX, moving.right];
  const movingY = [moving.top, moving.centreY, moving.bottom];

  let best: { dx: number; distance: number; at: number } | null = null;
  let bestY: { dy: number; distance: number; at: number } | null = null;

  for (const target of targets) {
    for (const candidate of [target.left, target.centreX, target.right]) {
      for (const own of movingX) {
        const distance = Math.abs(candidate - own);
        if (distance <= threshold && (!best || distance < best.distance)) {
          best = { dx: candidate - own, distance, at: candidate };
        }
      }
    }
    for (const candidate of [target.top, target.centreY, target.bottom]) {
      for (const own of movingY) {
        const distance = Math.abs(candidate - own);
        if (distance <= threshold && (!bestY || distance < bestY.distance)) {
          bestY = { dy: candidate - own, distance, at: candidate };
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (best) guides.push({ axis: 'x', at: best.at });
  if (bestY) guides.push({ axis: 'y', at: bestY.at });

  return { dx: best?.dx ?? 0, dy: bestY?.dy ?? 0, guides };
};
