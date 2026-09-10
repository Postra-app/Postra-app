import {
  readBox,
  scaleForSize,
  clampSize,
  clampCornerRadius,
  cornerRadiusOf,
  MIN_SIZE,
  MAX_SIZE,
} from './object-geometry';

describe('readBox', () => {
  it('reports the drawn size, not the source size', () => {
    expect(readBox({ left: 10.4, top: 20.6, width: 200, height: 100, scaleX: 2, scaleY: 0.5 }))
      .toEqual({ left: 10, top: 21, width: 400, height: 50 });
  });

  it('treats missing values as zero and scale one', () => {
    expect(readBox({})).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
});

describe('scaleForSize', () => {
  it('turns a wanted size into a scale', () => {
    expect(scaleForSize({ width: 200, height: 100 }, 400, 50)).toEqual({
      scaleX: 2,
      scaleY: 0.5,
    });
  });

  // A group with no intrinsic width would otherwise scale to Infinity and
  // vanish from the canvas.
  it('keeps the current scale when the source has no size', () => {
    expect(scaleForSize({ scaleX: 1.5, scaleY: 1.5 }, 400, 400)).toEqual({
      scaleX: 1.5,
      scaleY: 1.5,
    });
  });

  it('never scales below the minimum size', () => {
    expect(scaleForSize({ width: 100, height: 100 }, 0, -50).scaleX).toBe(MIN_SIZE / 100);
  });
});

describe('clampSize', () => {
  it('holds the range and rounds', () => {
    expect(clampSize(0)).toBe(MIN_SIZE);
    expect(clampSize(99_999)).toBe(MAX_SIZE);
    expect(clampSize(12.6)).toBe(13);
  });
});

describe('corner radius', () => {
  it('reads what is stored', () => {
    expect(cornerRadiusOf({ rx: 8.4 })).toBe(8);
    expect(cornerRadiusOf({})).toBe(0);
  });

  it('stops at half the shorter side', () => {
    const box = { left: 0, top: 0, width: 200, height: 80 };
    expect(clampCornerRadius(500, box)).toBe(40);
    expect(clampCornerRadius(-5, box)).toBe(0);
    expect(clampCornerRadius(12, box)).toBe(12);
  });

  it('survives a zero-sized box', () => {
    expect(clampCornerRadius(10, { left: 0, top: 0, width: 0, height: 0 })).toBe(0);
  });
});
