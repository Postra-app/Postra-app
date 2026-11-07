/**
 * A design's call to action drawn as a button: the brand's accent fills it
 * and the words take black or white, whichever reads on it (WCAG contrast).
 * Accent-coloured words straight on a photo were unreadable whenever the
 * photo was darker or busier than the accent. One rule for Studio's canvas
 * and for designs the server renders.
 */

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const value = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const luminance = (rgb: { r: number; g: number; b: number }) => {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
};

export const ctaStyle = (accent: string): { fill: string; backgroundColor: string } => {
  const rgb = hexToRgb(accent);
  if (!rgb) return { fill: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)' };
  const l = luminance(rgb);
  // contrast with white (1) vs with black (0), as WCAG computes it
  const withWhite = 1.05 / (l + 0.05);
  const withBlack = (l + 0.05) / 0.05;
  return { fill: withWhite >= withBlack ? '#ffffff' : '#000000', backgroundColor: accent };
};
