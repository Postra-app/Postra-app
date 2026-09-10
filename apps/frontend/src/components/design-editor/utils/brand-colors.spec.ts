import {
  hexToRgb,
  rgbToHex,
  contrastRatio,
  relativeLuminance,
  readableTextOn,
  quantize,
  pickBrandColors,
  isReadable,
  scrimFor,
  blend,
  averageColor,
  CONTRAST_AA_LARGE,
} from './brand-colors';

const px = (...colors: [number, number, number, number][]) =>
  colors.flatMap((c) => c);

describe('hex parsing', () => {
  it('reads both shorthand and full hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('38bdf8')).toEqual({ r: 56, g: 189, b: 248 });
  });

  it('rejects anything else', () => {
    expect(hexToRgb('#38bd')).toBeNull();
    expect(hexToRgb('rgb(1,2,3)')).toBeNull();
  });

  it('round-trips', () => {
    expect(rgbToHex(56, 189, 248)).toBe('#38bdf8');
  });
});

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#38bdf8', '#38bdf8')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#0a0e1a', '#ffffff')).toBe(contrastRatio('#ffffff', '#0a0e1a'));
  });

  it('picks the readable text colour for a background', () => {
    expect(readableTextOn('#0a0e1a')).toBe('#ffffff');
    expect(readableTextOn('#f8fafc')).toBe('#000000');
  });

  it('knows what fails the large-text bar', () => {
    expect(isReadable('#ffffff', '#0a0e1a')).toBe(true);
    // Mid grey on white: about 1.6:1.
    expect(isReadable('#bbbbbb', '#ffffff')).toBe(false);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(CONTRAST_AA_LARGE);
  });
});

describe('quantize', () => {
  it('ranks buckets by how much of the image they cover', () => {
    const pixels = px(
      [250, 10, 10, 255],
      [248, 12, 8, 255],
      [10, 10, 250, 255],
      [252, 8, 14, 255]
    );
    const swatches = quantize(pixels);
    expect(swatches[0].count).toBe(3);
    expect(swatches[0].hex).toMatch(/^#f/);
    expect(swatches).toHaveLength(2);
  });

  // A logo is mostly transparent; counting those pixels made every palette
  // come out the same colour as the empty space.
  it('ignores transparent pixels', () => {
    expect(quantize(px([255, 255, 255, 0], [255, 255, 255, 10]))).toEqual([]);
  });

  it('averages the colours inside a bucket instead of taking the first', () => {
    const swatches = quantize(px([100, 100, 100, 255], [110, 110, 110, 255]));
    expect(swatches[0].hex).toBe('#696969');
  });
});

describe('pickBrandColors', () => {
  it('takes the colourful part as primary and a dark part as background', () => {
    const palette = pickBrandColors([
      { hex: '#0a0e1a', count: 50 },
      { hex: '#38bdf8', count: 30 },
      { hex: '#cccccc', count: 20 },
    ]);
    expect(palette).toEqual({
      primaryColor: '#38bdf8',
      secondaryColor: '#0a0e1a',
      textColor: '#ffffff',
    });
  });

  it('falls back to the studio background when the logo has no dark colour', () => {
    const palette = pickBrandColors([{ hex: '#38bdf8', count: 10 }]);
    expect(palette?.secondaryColor).toBe('#0a0e1a');
    expect(palette?.primaryColor).toBe('#38bdf8');
  });

  it('still answers for a greyscale logo', () => {
    const palette = pickBrandColors([{ hex: '#eeeeee', count: 10 }]);
    expect(palette?.primaryColor).toBe('#eeeeee');
  });

  it('returns null when there is nothing to read', () => {
    expect(pickBrandColors([])).toBeNull();
  });
});

describe('scrimFor', () => {
  it('says nothing is needed when the text already reads', () => {
    expect(scrimFor('#ffffff', '#0a0e1a')).toBeNull();
  });

  it('darkens behind light text and lightens behind dark text', () => {
    expect(scrimFor('#ffffff', '#c8c8c8')?.color).toBe('#000000');
    expect(scrimFor('#111111', '#3a3a3a')?.color).toBe('#ffffff');
  });

  it('returns the lightest scrim that does the job', () => {
    const scrim = scrimFor('#ffffff', '#9a9a9a');
    expect(scrim).not.toBeNull();
    expect(blend('#9a9a9a', scrim!.color, scrim!.opacity)).toBeDefined();
    expect(isReadable('#ffffff', blend('#9a9a9a', scrim!.color, scrim!.opacity))).toBe(true);
    expect(scrim!.opacity).toBeLessThanOrEqual(0.8);
  });
});

describe('blend', () => {
  it('composites an overlay at an alpha', () => {
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(blend('#123456', '#ffffff', 0)).toBe('#123456');
  });

  it('leaves a colour it cannot parse alone', () => {
    expect(blend('nonsense', '#ffffff', 0.5)).toBe('nonsense');
  });
});

describe('averageColor', () => {
  it('averages the visible pixels', () => {
    expect(averageColor(px([0, 0, 0, 255], [255, 255, 255, 255]))).toBe('#808080');
  });

  it('answers black for an empty sample rather than throwing', () => {
    expect(averageColor([])).toBe('#000000');
  });
});
