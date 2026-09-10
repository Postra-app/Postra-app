/**
 * Colour maths for the Brand Kit: pulling a palette out of a logo, and telling
 * the user when text has landed somewhere it cannot be read.
 *
 * Deliberately dependency-free. `color-thief` would do the first half, but it
 * is a new dependency for about forty lines of arithmetic, and none of this
 * needs a canvas — which is what makes it testable.
 */

export interface Swatch {
  hex: string;
  count: number;
}

const toHex = (n: number) => n.toString(16).padStart(2, '0');

export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${toHex(Math.round(r))}${toHex(Math.round(g))}${toHex(Math.round(b))}`;

export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const value = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

/** WCAG relative luminance. */
export const relativeLuminance = (hex: string): number => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
};

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

/** Black or white, whichever can be read on this background. */
export const readableTextOn = (background: string): string =>
  contrastRatio('#ffffff', background) >= contrastRatio('#000000', background)
    ? '#ffffff'
    : '#000000';

const saturationOf = (hex: string): number => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return max === 0 ? 0 : (max - min) / max;
};

/** Group pixels into coarse colour buckets and rank them by how much of the
 *  image they cover. Fully transparent pixels are skipped — a logo is mostly
 *  transparent, and counting those would make every palette "white". */
export const quantize = (
  pixels: ArrayLike<number>,
  bucketSize = 32
): Swatch[] => {
  const counts = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 200) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const key = [r, g, b].map((c) => Math.floor(c / bucketSize)).join(',');
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
      entry.r += r;
      entry.g += g;
      entry.b += b;
    } else {
      counts.set(key, { count: 1, r, g, b });
    }
  }
  return [...counts.values()]
    .map(({ count, r, g, b }) => ({
      hex: rgbToHex(r / count, g / count, b / count),
      count,
    }))
    .sort((a, b) => b.count - a.count);
};

export interface BrandPalette {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
}

/**
 * A three-colour kit from a logo's swatches:
 * - primary is the most colourful thing in the logo, because that is the brand;
 * - background is the darkest common colour, since Studio designs are dark;
 * - text is whichever of black/white can actually be read on that background.
 */
export const pickBrandColors = (swatches: Swatch[]): BrandPalette | null => {
  const usable = swatches.filter((s) => s.count > 0);
  if (!usable.length) return null;

  // Saturation alone is not enough: near-black navy reads as highly saturated
  // (its channels differ a lot in relative terms) while looking like a
  // background, so the brand colour also has to be light enough to see.
  const colourful = [...usable]
    .filter((s) => {
      const luminance = relativeLuminance(s.hex);
      return saturationOf(s.hex) > 0.25 && luminance > 0.03 && luminance < 0.85;
    })
    .sort((a, b) => b.count - a.count);
  const primary = (colourful[0] ?? usable[0]).hex;

  // Prefer a dark background from the logo, but only if the logo really has
  // one; a logo of pure colour on transparency should not force a mid-grey.
  const dark = [...usable]
    .filter((s) => relativeLuminance(s.hex) < 0.12)
    .sort((a, b) => b.count - a.count);
  const secondary = dark[0]?.hex ?? '#0a0e1a';

  return {
    primaryColor: primary,
    secondaryColor: secondary,
    textColor: readableTextOn(secondary),
  };
};

/** WCAG AA for large text. Studio text is display-sized, so this is the bar
 *  worth warning about — 4.5 would cry wolf on every poster. */
export const CONTRAST_AA_LARGE = 3;

export const isReadable = (textColor: string, background: string): boolean =>
  contrastRatio(textColor, background) >= CONTRAST_AA_LARGE;

/** The scrim (a translucent black or white layer) that lifts text back over
 *  the readable line. Returns null when none is needed, or when even a full
 *  scrim would not help. */
export const scrimFor = (
  textColor: string,
  background: string
): { color: string; opacity: number } | null => {
  if (isReadable(textColor, background)) return null;
  const scrimColor = relativeLuminance(textColor) > 0.5 ? '#000000' : '#ffffff';
  for (let opacity = 0.2; opacity <= 0.8; opacity += 0.1) {
    const blended = blend(background, scrimColor, opacity);
    if (isReadable(textColor, blended)) {
      return { color: scrimColor, opacity: Math.round(opacity * 10) / 10 };
    }
  }
  return { color: scrimColor, opacity: 0.8 };
};

/** Flat alpha composite of `overlay` at `alpha` on top of `base`. */
export const blend = (base: string, overlay: string, alpha: number): string => {
  const b = hexToRgb(base);
  const o = hexToRgb(overlay);
  if (!b || !o) return base;
  return rgbToHex(
    b.r * (1 - alpha) + o.r * alpha,
    b.g * (1 - alpha) + o.g * alpha,
    b.b * (1 - alpha) + o.b * alpha
  );
};

/** Average colour of a block of pixels, as a hex string. */
export const averageColor = (pixels: ArrayLike<number>): string => {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
    n += 1;
  }
  if (!n) return '#000000';
  return rgbToHex(r / n, g / n, b / n);
};
