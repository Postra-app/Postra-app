import type * as fabric from 'fabric';
import {
  repositionObjectFromTo,
  isBackgroundBox,
} from './multi-format-renderer';

/**
 * Switching platform sizes moves and rescales every layer. The bug this guards
 * against was silent and cumulative: scaling by min(dstW/srcW, dstH/srcH) loses
 * size on every aspect-ratio change and never gives it back, so clicking around
 * the format bar shrank text a little at a time until it disappeared. The
 * property that matters is REVERSIBILITY — a round trip must land where it
 * started.
 */

// Only the geometry fields are read or written, so a literal stands in for a
// Fabric object and keeps canvas out of the test.
type Geom = {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  originX?: string;
  originY?: string;
};

const obj = (
  o: Partial<Geom>
): Geom & { set: (v: Partial<Geom>) => void; setCoords: () => void } => {
  const base = {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    scaleX: 1,
    scaleY: 1,
    ...o,
  } as Geom & { set: (v: Partial<Geom>) => void; setCoords: () => void };
  base.set = (v: Partial<Geom>) => Object.assign(base, v);
  // Real Fabric objects must be told to refresh their cached corners after a
  // move, or the renderer skips them as off-screen.
  base.setCoords = () => undefined;
  return base;
};

const move = (o: ReturnType<typeof obj>, from: [number, number], to: [number, number]) =>
  repositionObjectFromTo(o as unknown as fabric.Object, from[0], from[1], to[0], to[1]);

const SQUARE: [number, number] = [1080, 1080];
const STORY: [number, number] = [1080, 1920];
const LANDSCAPE: [number, number] = [1600, 900];
const PORTRAIT: [number, number] = [1080, 1350];

describe('repositionObjectFromTo', () => {
  it('returns a layer to its original size after a round trip', () => {
    // Size is the property that used to decay: every trip through a different
    // aspect ratio shaved a bit off and nothing ever put it back.
    const o = obj({ left: 140, top: 300, width: 400, height: 120 });
    move(o, SQUARE, STORY);
    move(o, STORY, SQUARE);
    expect(o.scaleX).toBeCloseTo(1, 5);
    expect(o.scaleY).toBeCloseTo(1, 5);
  });

  it('returns a centred layer to its exact place after a round trip', () => {
    // Position is round-trippable because every branch maps a single measure
    // through the same ratio: an edge gap, or the layer's own centre.
    const o = obj({ left: 340, top: 480, width: 400, height: 120 });
    move(o, SQUARE, STORY);
    move(o, STORY, SQUARE);
    expect(o.left).toBeCloseTo(340, 3);
    expect(o.top).toBeCloseTo(480, 3);
  });

  it('survives a tour of every format without shrinking', () => {
    const o = obj({ left: 140, top: 300, width: 400, height: 120 });
    move(o, SQUARE, STORY);
    move(o, STORY, LANDSCAPE);
    move(o, LANDSCAPE, STORY);
    move(o, STORY, SQUARE);
    expect(o.scaleX).toBeCloseTo(1, 5);
    expect(o.width * o.scaleX).toBeCloseTo(400, 3);
  });

  it('scales by the short side, so a square-to-story move keeps the size', () => {
    const o = obj({ left: 340, top: 480, width: 400, height: 120 });
    move(o, SQUARE, STORY);
    // Both formats are 1080 wide, so nothing should have been resized.
    expect(o.scaleX).toBeCloseTo(1, 5);
  });

  it('never lets a layer grow past the destination canvas', () => {
    const o = obj({ left: 0, top: 0, width: 1000, height: 200 });
    move(o, SQUARE, LANDSCAPE);
    expect(o.width * o.scaleX).toBeLessThanOrEqual(LANDSCAPE[0] + 0.001);
  });

  it('keeps a background layer covering the whole frame', () => {
    // Anything at least half the canvas area counts as background.
    const o = obj({ left: 0, top: 0, width: 1080, height: 1080 });
    move(o, SQUARE, STORY);
    expect(o.width * o.scaleX).toBeGreaterThanOrEqual(STORY[0] - 0.001);
    expect(o.height * o.scaleY).toBeGreaterThanOrEqual(STORY[1] - 0.001);
  });

  it('keeps an edge-anchored layer on its edge, with proportional padding', () => {
    // Bottom-left caption: 5% in from the left, 5% up from the bottom. The
    // gaps stay at 5% of the NEW canvas, so the layout reads the same on a
    // taller frame rather than clinging to a pixel count.
    const o = obj({ left: 54, top: 918, width: 200, height: 108 });
    move(o, SQUARE, STORY);
    expect(o.left / STORY[0]).toBeCloseTo(0.05, 3);
    const bottomGap = STORY[1] - (o.top + o.height * o.scaleY);
    expect(bottomGap / STORY[1]).toBeCloseTo(0.05, 3);
  });

  it('re-centres a layer that really is centred', () => {
    const o = obj({ left: 340, top: 480, width: 400, height: 120 });
    move(o, SQUARE, STORY);
    const centreX = o.left + (o.width * o.scaleX) / 2;
    expect(centreX).toBeCloseTo(STORY[0] / 2, 3);
  });

  it('keeps two stacked middle layers apart instead of piling them up', () => {
    // The reported bug (STU-G-34). Both layers sit in the middle band, so both
    // were classed 'centre' and both were then placed at the exact centre of
    // the destination — one printed on top of the other. Every mid-canvas
    // layout is built like this: headline, then a line under it.
    const headline = obj({ left: 54, top: 432, width: 972, height: 350 });
    const subtitle = obj({ left: 81, top: 918, width: 918, height: 56 });
    move(headline, PORTRAIT, SQUARE);
    move(subtitle, PORTRAIT, SQUARE);

    const headlineBottom = headline.top + headline.height * headline.scaleY;
    expect(subtitle.top).toBeGreaterThan(headlineBottom);
  });

  it('keeps a middle layer at its own height in the frame, not at the middle', () => {
    // 70% down a 4:5 frame is 70% down a square one too — not 50%.
    const o = obj({ left: 81, top: 918, width: 918, height: 56 });
    move(o, PORTRAIT, SQUARE);
    const centreY = o.top + (o.height * o.scaleY) / 2;
    expect(centreY / SQUARE[1]).toBeCloseTo(946 / 1350, 3);
  });

  it('leaves the whole promo template free of overlaps after a format change', () => {
    // The six layers of the built-in "Modern Promo" at 4:5, in z-order.
    const layers = [
      obj({ left: 0, top: 0, width: 1080, height: 202.5 }),
      obj({ left: 540, top: 60.75, width: 972, height: 56, originX: 'center' }),
      obj({ left: 540, top: 432, width: 972, height: 350, originX: 'center' }),
      obj({ left: 540, top: 918, width: 918, height: 56, originX: 'center' }),
      obj({ left: 540, top: 1107, width: 432, height: 108, originX: 'center' }),
      obj({ left: 540, top: 1134, width: 432, height: 50, originX: 'center' }),
    ];
    layers.forEach((o) => move(o, PORTRAIT, SQUARE));

    // Bands that must not collide: headline vs the line under it, and that
    // line vs the call to action. The text inside the bar and inside the
    // button is meant to sit on top of them, so those pairs are skipped.
    const band = (o: (typeof layers)[number]) => ({
      top: o.top,
      bottom: o.top + o.height * o.scaleY,
    });
    const headline = band(layers[2]);
    const subtitle = band(layers[3]);
    const cta = band(layers[4]);

    expect(subtitle.top).toBeGreaterThan(headline.bottom);
    expect(cta.top).toBeGreaterThan(subtitle.bottom);
    expect(cta.bottom).toBeLessThanOrEqual(SQUARE[1]);
  });

  it('returns a mid-canvas layer to its place after a round trip', () => {
    // Same reversibility promise as before, now that the centre branch moves
    // the layer instead of snapping it.
    const o = obj({ left: 81, top: 918, width: 918, height: 56 });
    move(o, PORTRAIT, SQUARE);
    move(o, SQUARE, PORTRAIT);
    expect(o.top).toBeCloseTo(918, 3);
    expect(o.left).toBeCloseTo(81, 3);
  });

  it('honours centre origins when reading and writing position', () => {
    const o = obj({
      left: 540,
      top: 540,
      width: 400,
      height: 120,
      originX: 'center',
      originY: 'center',
    });
    move(o, SQUARE, STORY);
    // Still centred horizontally, and `left` is still the object's centre.
    expect(o.left).toBeCloseTo(STORY[0] / 2, 3);
  });
});

describe('isBackgroundBox', () => {
  const SRC_W = 1080;
  const SRC_H = 1350;

  it('accepts a layer that fills the canvas', () => {
    expect(
      isBackgroundBox({ left: 0, top: 0, width: SRC_W, height: SRC_H }, SRC_W, SRC_H)
    ).toBe(true);
  });

  // The bug this guards: a template's content card is over half the canvas by
  // area, and cover-scaling it to the new format wrecked the layout.
  it('rejects a big card floating in the middle', () => {
    expect(
      isBackgroundBox(
        { left: 120, top: 300, width: 840, height: 800 },
        SRC_W,
        SRC_H
      )
    ).toBe(false);
  });

  it('rejects a layer that reaches the edges but is too small', () => {
    expect(
      isBackgroundBox({ left: 0, top: 0, width: SRC_W, height: 200 }, SRC_W, SRC_H)
    ).toBe(false);
  });

  it('tolerates a background a few pixels off the corner', () => {
    expect(
      isBackgroundBox(
        { left: -10, top: -10, width: SRC_W + 20, height: SRC_H + 20 },
        SRC_W,
        SRC_H
      )
    ).toBe(true);
  });
});
