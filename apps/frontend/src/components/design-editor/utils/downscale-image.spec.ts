import { fitWithin, MAX_DESIGN_IMAGE_EDGE } from './downscale-image';

describe('fitWithin', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitWithin(2048, 1536)).toBeNull();
    expect(fitWithin(1080, 1350)).toBeNull();
  });

  it('caps the longest side and keeps the proportions', () => {
    expect(fitWithin(8000, 6000)).toEqual({ width: MAX_DESIGN_IMAGE_EDGE, height: 1536 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1536, height: MAX_DESIGN_IMAGE_EDGE });
  });
});
