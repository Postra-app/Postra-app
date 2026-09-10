import {
  sizeForOrientation,
  normalizeOrientation,
  orientationForSize,
} from './image-orientation';

describe('sizeForOrientation', () => {
  it('maps each shape to the size the API takes', () => {
    expect(sizeForOrientation('square')).toBe('1024x1024');
    expect(sizeForOrientation('portrait')).toBe('1024x1536');
    expect(sizeForOrientation('landscape')).toBe('1536x1024');
  });
});

describe('normalizeOrientation', () => {
  it('still understands the old boolean', () => {
    expect(normalizeOrientation(true)).toBe('portrait');
    expect(normalizeOrientation(false)).toBe('square');
  });

  it('passes through a valid orientation and rejects anything else', () => {
    expect(normalizeOrientation('landscape')).toBe('landscape');
    expect(normalizeOrientation(undefined)).toBe('square');
    expect(normalizeOrientation('sideways' as never)).toBe('square');
  });
});

describe('orientationForSize', () => {
  it('reads the format the design is in', () => {
    expect(orientationForSize(1600, 900)).toBe('landscape');
    expect(orientationForSize(1080, 1920)).toBe('portrait');
    expect(orientationForSize(1080, 1080)).toBe('square');
  });

  // IG Feed (4:5) asks for the portrait generation: cropping 2:3 down to 4:5
  // loses a fifth of the height, where a square would have to be padded.
  it('treats 4:5 as portrait', () => {
    expect(orientationForSize(1080, 1350)).toBe('portrait');
  });

  // LinkedIn's square and anything close to it stays square.
  it('keeps near-square formats square', () => {
    expect(orientationForSize(1200, 1200)).toBe('square');
    expect(orientationForSize(1200, 1100)).toBe('square');
  });

  it('survives a missing size', () => {
    expect(orientationForSize(0, 0)).toBe('square');
  });
});
