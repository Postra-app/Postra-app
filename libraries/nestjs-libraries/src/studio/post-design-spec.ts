/**
 * Shared, framework-free description of a generated post design (`PostDesignSpec`).
 *
 * This is the AI *generation* shape — a flat headline/subtext/cta over a
 * background — as opposed to `StudioSpec` (the semantic layer list used for
 * roundtrip editing). It is produced by `OpenaiService.generatePostDesign`
 * (which returns everything except the background) and finished off in
 * `MediaService.generatePostDesign` (which adds `backgroundUrl` / `brandKit`).
 *
 * The layout maths live here — with no DOM and no Fabric import — so the
 * browser renderer (`design-editor/utils/canvas-renderer.ts`) and the
 * server-side renderer (`design-render.service.ts`) compute identical
 * positions and can never drift.
 */

export type PostDesignLayout =
  | 'centered-stack'
  | 'left-aligned'
  | 'bottom-stack'
  | 'top-banner';

export interface PostDesignSpec {
  headline: string;
  subtext: string;
  cta: string;
  imagePrompt: string;
  colors: { background: string; accent: string; text: string };
  layout: PostDesignLayout;
  backgroundUrl: string;
  cacheHit: boolean;
  brandKit?: { logoPath: string | null } | null;
}

export const DESIGN_TEXT_FONT = 'Geist, sans-serif';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The model is asked for hex colours but nothing holds it to that, and the
 * renderers hand them to the canvas, which throws on anything it cannot parse
 * and leaves half a design. A colour that is not a hex one is replaced: by the
 * brand's own colour when there is one, otherwise by a readable default.
 */
export const safeDesignColors = (
  colors: Partial<PostDesignSpec['colors']> | undefined,
  brand?: { primary?: string; secondary?: string; text?: string }
): PostDesignSpec['colors'] => {
  const pick = (value: string | undefined, ...fallbacks: (string | undefined)[]) =>
    [value, ...fallbacks].find((c): c is string => !!c && HEX_COLOR.test(c.trim()))!.trim();
  return {
    background: pick(colors?.background, brand?.secondary, '#1a1a2e'),
    accent: pick(colors?.accent, brand?.primary, '#38bdf8'),
    text: pick(colors?.text, brand?.text, '#ffffff'),
  };
};

export interface DesignPositionEntry {
  left: number;
  top: number;
  textAlign: 'left' | 'center';
  originX: 'left' | 'center';
  originY: 'top';
}

export interface DesignLayoutPositions {
  headline: DesignPositionEntry;
  subtext: DesignPositionEntry;
  cta: DesignPositionEntry;
}

/**
 * Fabric v7 default originX = 'center'. We keep explicit origins so `left` is
 * interpreted as either box-left-edge (originX='left') or box-horizontal-center
 * (originX='center'). Without this the left-aligned layout cuts text off the
 * left of the canvas.
 */
export const computeLayout = (
  layout: PostDesignLayout,
  width: number,
  height: number
): DesignLayoutPositions => {
  const cx = width / 2;
  switch (layout) {
    case 'left-aligned':
      return {
        headline: { left: width * 0.08, top: height * 0.45, textAlign: 'left', originX: 'left', originY: 'top' },
        subtext: { left: width * 0.08, top: height * 0.6, textAlign: 'left', originX: 'left', originY: 'top' },
        cta: { left: width * 0.08, top: height * 0.78, textAlign: 'left', originX: 'left', originY: 'top' },
      };
    case 'bottom-stack':
      return {
        headline: { left: cx, top: height * 0.62, textAlign: 'center', originX: 'center', originY: 'top' },
        subtext: { left: cx, top: height * 0.76, textAlign: 'center', originX: 'center', originY: 'top' },
        cta: { left: cx, top: height * 0.88, textAlign: 'center', originX: 'center', originY: 'top' },
      };
    case 'top-banner':
      return {
        headline: { left: cx, top: height * 0.12, textAlign: 'center', originX: 'center', originY: 'top' },
        subtext: { left: cx, top: height * 0.26, textAlign: 'center', originX: 'center', originY: 'top' },
        cta: { left: cx, top: height * 0.4, textAlign: 'center', originX: 'center', originY: 'top' },
      };
    case 'centered-stack':
    default:
      return {
        headline: { left: cx, top: height * 0.42, textAlign: 'center', originX: 'center', originY: 'top' },
        subtext: { left: cx, top: height * 0.56, textAlign: 'center', originX: 'center', originY: 'top' },
        cta: { left: cx, top: height * 0.72, textAlign: 'center', originX: 'center', originY: 'top' },
      };
  }
};

export interface DesignFontSizes {
  headline: number;
  subtext: number;
  cta: number;
}

export const computeDesignFontSizes = (width: number): DesignFontSizes => ({
  headline: Math.round(width * 0.07),
  subtext: Math.round(width * 0.035),
  cta: Math.round(width * 0.03),
});

/** Text box widths, as a fraction of canvas width, matching the browser renderer. */
export const DESIGN_TEXTBOX_WIDTH = {
  headline: 0.84,
  subtext: 0.78,
  cta: 0.5,
} as const;

export interface DesignSize {
  width: number;
  height: number;
}

/**
 * A sensible canvas size for a generated design, keyed off the target social
 * platform. Defaults to a 4:5 portrait (1080×1350) — the strongest all-round
 * feed format and the design editor's own default.
 */
export const platformDesignSize = (platform?: string): DesignSize => {
  switch ((platform || '').toLowerCase()) {
    case 'instagram':
    case 'instagram-standalone':
    case 'facebook':
    case 'threads':
    case 'linkedin':
    case 'mastodon':
    case 'bluesky':
      return { width: 1080, height: 1350 };
    case 'instagram-story':
    case 'tiktok':
    case 'youtube-short':
      return { width: 1080, height: 1920 };
    case 'x':
    case 'twitter':
      return { width: 1600, height: 900 };
    default:
      return { width: 1080, height: 1350 };
  }
};
