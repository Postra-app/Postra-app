import { STUDIO_FONTS } from '../design-editor/fonts';

/**
 * Branded text rendering for Postra Clip. The compositor pipeline decodes each
 * frame and hands us a 2D context; these helpers paint a legible, on-brand text
 * band on top. Shared by manual text (Faza 2) and AI captions (Faza 4) — same
 * look, the only difference is where the text comes from.
 */

export type TextPosition = 'top' | 'middle' | 'bottom';

/** Resolve a Brand Kit font label ("Inter") to its CSS family stack. */
export function fontFamilyForLabel(label: string): string {
  return STUDIO_FONTS.find((f) => f.label === label)?.family ?? STUDIO_FONTS[0].family;
}

/**
 * Ensure a webfont is rasterised before we paint it onto a canvas. Canvas 2D
 * silently falls back to a default face if the font isn't loaded yet, so a clip
 * would otherwise render in the wrong typeface on first use.
 */
export async function ensureFontLoaded(family: string, sizePx: number): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await document.fonts.load(`bold ${sizePx}px ${family}`);
    await document.fonts.ready;
  } catch {
    // Non-fatal — render with whatever face is available.
  }
}

/** Translucent colour from a #hex, used for the legibility band. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([\da-f]{6}|[\da-f]{3})$/i.exec(hex.trim());
  if (!m) return `rgba(0, 0, 0, ${alpha})`;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * How much of the frame the platform's own interface covers.
 *
 * Measured against TikTok and Reels at 1080x1920: the caption, handle and the
 * action rail take roughly the bottom 250-300 px, so a band sitting 4 % from
 * the bottom (77 px) lands underneath them. Vertical video therefore keeps a
 * much deeper bottom margin; square and landscape do not have the problem.
 */
export function safeAreaMargin(
  width: number,
  height: number
): { top: number; bottom: number } {
  const vertical = height / width >= 1.5;
  return {
    top: Math.round(height * (vertical ? 0.08 : 0.04)),
    bottom: Math.round(height * (vertical ? 0.13 : 0.04)),
  };
}

export interface BrandTextStyle {
  text: string;
  position: TextPosition;
  /** Text fill — defaults to the Brand Kit primary colour. */
  color: string;
  /** Legibility plate behind the text (usually the brand background, translucent). */
  bandColor: string;
  /** CSS font family stack (see {@link fontFamilyForLabel}). */
  fontFamily: string;
  /** Multiplier over the auto-computed size (~0.8 small … 1.25 large). */
  scale?: number;
}

/**
 * Paint a centred, word-wrapped text band onto a single frame. Width/height are
 * the frame's pixel dimensions; the font size scales with width so the result
 * looks consistent across 9:16 / 1:1 / 16:9.
 */
export function drawBrandText(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: BrandTextStyle
): void {
  const text = style.text.trim();
  if (!text) return;

  const fontSize = Math.max(18, Math.round(width * 0.055 * (style.scale ?? 1)));
  const lineHeight = Math.round(fontSize * 1.3);
  ctx.font = `bold ${fontSize}px ${style.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = wrapLines(ctx, text, width * 0.86);
  if (!lines.length) return;

  const padY = Math.round(fontSize * 0.6);
  const blockHeight = lines.length * lineHeight + padY * 2;
  const margin = safeAreaMargin(width, height);

  let top: number;
  if (style.position === 'top') top = margin.top;
  else if (style.position === 'middle') top = Math.round((height - blockHeight) / 2);
  else top = height - blockHeight - margin.bottom;

  ctx.fillStyle = style.bandColor;
  ctx.fillRect(0, top, width, blockHeight);

  // The band is translucent, so on a bright frame the text was competing with
  // whatever showed through. An outline costs nothing and survives any
  // background.
  const outline = Math.max(2, Math.round(fontSize * 0.08));
  ctx.lineWidth = outline;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.fillStyle = style.color;
  let y = top + padY + lineHeight / 2;
  for (const line of lines) {
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
    y += lineHeight;
  }
}
