import {
  cropFromRect,
  resetCrop,
  initialCropRect,
  fitReplacement,
  CroppableImage,
} from './image-crop';

const image = (over: Partial<CroppableImage> = {}): CroppableImage => ({
  left: 100,
  top: 50,
  width: 400,
  height: 300,
  cropX: 0,
  cropY: 0,
  scaleX: 1,
  scaleY: 1,
  sourceWidth: 400,
  sourceHeight: 300,
  ...over,
});

describe('cropFromRect', () => {
  it('turns a frame into the source window it selects', () => {
    const result = cropFromRect(image(), {
      left: 200,
      top: 100,
      width: 100,
      height: 50,
    });
    expect(result).toEqual({
      cropX: 100,
      cropY: 50,
      width: 100,
      height: 50,
      left: 200,
      top: 100,
    });
  });

  it('reads the frame through the scale the image is drawn at', () => {
    const result = cropFromRect(image({ scaleX: 2, scaleY: 2 }), {
      left: 300,
      top: 150,
      width: 200,
      height: 100,
    });
    // 200 canvas px at 2x is 100 source px.
    expect(result.cropX).toBe(100);
    expect(result.cropY).toBe(50);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('adds to an existing crop instead of replacing it', () => {
    const result = cropFromRect(image({ cropX: 40, cropY: 20, width: 360, height: 280 }), {
      left: 110,
      top: 60,
      width: 100,
      height: 100,
    });
    expect(result.cropX).toBe(50);
    expect(result.cropY).toBe(30);
  });

  // Dragging the frame off the edge used to be able to select source pixels
  // that do not exist, which draws as transparent gaps.
  it('clamps a frame that starts outside the image', () => {
    const result = cropFromRect(image(), {
      left: 0,
      top: 0,
      width: 200,
      height: 120,
    });
    expect(result.cropX).toBe(0);
    expect(result.cropY).toBe(0);
    expect(result.width).toBe(100);
    expect(result.height).toBe(70);
    expect(result.left).toBe(100);
  });

  it('clamps a frame that runs past the far edge', () => {
    const result = cropFromRect(image(), {
      left: 400,
      top: 300,
      width: 400,
      height: 400,
    });
    expect(result.cropX + result.width).toBeLessThanOrEqual(400);
    expect(result.cropY + result.height).toBeLessThanOrEqual(300);
  });

  it('never crops to nothing', () => {
    const result = cropFromRect(image(), { left: 200, top: 100, width: 0, height: 0 });
    expect(result.width).toBeGreaterThanOrEqual(8);
    expect(result.height).toBeGreaterThanOrEqual(8);
  });
});

describe('resetCrop', () => {
  it('shows the whole source again', () => {
    expect(resetCrop(image({ cropX: 50, cropY: 25, width: 100, height: 100 }))).toEqual({
      cropX: 0,
      cropY: 0,
      width: 400,
      height: 300,
      left: 100,
      top: 50,
    });
  });
});

describe('initialCropRect', () => {
  it('starts inside the image so every handle can be grabbed', () => {
    const rect = initialCropRect(image());
    expect(rect).toEqual({ left: 140, top: 80, width: 320, height: 240 });
  });
});

describe('fitReplacement', () => {
  it('covers the same box with a taller photo, cropping the overflow', () => {
    const fit = fitReplacement(
      { width: 400, height: 300, scaleX: 1, scaleY: 1 },
      { width: 1000, height: 2000 }
    );
    // The box is 400x300; covering it from a 1000x2000 source scales by 0.4
    // and hides the vertical overflow.
    expect(fit.scaleX).toBeCloseTo(0.4);
    expect(fit.width).toBe(1000);
    expect(fit.height).toBe(750);
    expect(fit.cropY).toBe(625);
    expect(fit.cropX).toBe(0);
  });

  it('keeps the drawn box the same size as before', () => {
    const fit = fitReplacement(
      { width: 400, height: 300, scaleX: 2, scaleY: 2 },
      { width: 800, height: 800 }
    );
    expect(fit.width * fit.scaleX).toBeCloseTo(800);
    expect(fit.height * fit.scaleY).toBeCloseTo(600);
  });

  it('gives up quietly on a source with no dimensions', () => {
    const fit = fitReplacement(
      { width: 400, height: 300, scaleX: 1, scaleY: 1 },
      { width: 0, height: 0 }
    );
    expect(fit.scaleX).toBe(1);
  });
});
