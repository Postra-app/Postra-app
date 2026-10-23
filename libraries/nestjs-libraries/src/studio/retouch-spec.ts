import { z } from 'zod';
import { withoutLongDashes } from '@gitroom/helpers/utils/long.dashes';

/**
 * Photo retouch: the contract between the model that looks at a photo and the
 * pipeline that changes its pixels.
 *
 * The model never touches pixels. Like the tools photographers use (Imagen
 * AI, Aftershoot, Lightroom's Auto) it only decides how far to move a few
 * global controls, as intents in -1..1 where 0 is "leave it". The level the
 * user picked caps how far any control may go, and `pipelineFor` turns the
 * capped intents into the exact numbers sharp applies - so the same spec and
 * level always give the same bytes, and a wild answer from the model can
 * never do more than the level allows.
 */

export const RETOUCH_LEVELS = ['light', 'medium', 'strong', 'bw'] as const;
export type RetouchLevel = (typeof RETOUCH_LEVELS)[number];

// OpenAI strict structured outputs need every field required.
export const RetouchSpecSchema = z.object({
  // -1 darker .. 1 brighter
  exposure: z.number(),
  // -1 flatter .. 1 punchier
  contrast: z.number(),
  // -1 cooler .. 1 warmer
  temperature: z.number(),
  // -1 greener .. 1 more magenta
  tint: z.number(),
  // 0 .. 1: lift shadows / bring out detail in dark areas
  shadows: z.number(),
  // -1 muted .. 1 more vivid
  saturation: z.number(),
  // 0 .. 1
  sharpen: z.number(),
  // One short sentence, what changed and why.
  summary: z.string(),
});
export type RetouchSpec = z.infer<typeof RetouchSpecSchema>;

/** How far (fraction of the full range) each level lets a control move. */
export const LEVEL_REACH: Record<RetouchLevel, number> = {
  light: 0.35,
  medium: 0.65,
  strong: 1,
  // Black & white tones like "medium" and drops the colour.
  bw: 0.65,
};

export const SUMMARY_MAX = 240;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

/**
 * The model's decision as stored: numbers kept inside the contract's own
 * range (-1..1, shadows and sharpen 0..1) and the summary sanitised, but NOT
 * capped to a level. The level caps at pipeline time, so a decision made for
 * Light can be redone at Strong and go further (Codex, 2026-10-23).
 */
export const boundSpec = (spec: RetouchSpec): RetouchSpec => ({
  exposure: clamp(spec.exposure, -1, 1),
  contrast: clamp(spec.contrast, -1, 1),
  temperature: clamp(spec.temperature, -1, 1),
  tint: clamp(spec.tint, -1, 1),
  shadows: clamp(spec.shadows, 0, 1),
  saturation: clamp(spec.saturation, -1, 1),
  sharpen: clamp(spec.sharpen, 0, 1),
  summary: withoutLongDashes(String(spec.summary ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUMMARY_MAX),
});

/** Cap every control to what the level allows; sanitise the summary. */
export const clampSpec = (spec: RetouchSpec, level: RetouchLevel): RetouchSpec => {
  const reach = LEVEL_REACH[level];
  return {
    exposure: clamp(spec.exposure, -reach, reach),
    contrast: clamp(spec.contrast, -reach, reach),
    temperature: clamp(spec.temperature, -reach, reach),
    tint: clamp(spec.tint, -reach, reach),
    shadows: clamp(spec.shadows, 0, reach),
    saturation: level === 'bw' ? 0 : clamp(spec.saturation, -reach, reach),
    sharpen: clamp(spec.sharpen, 0, reach),
    summary: withoutLongDashes(String(spec.summary ?? ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SUMMARY_MAX),
  };
};

/** The exact numbers sharp applies, in pipeline order. */
export interface RetouchPipeline {
  // per-channel multipliers (white balance x exposure), then contrast
  // around mid-grey: out = a * (gain * in - 128) + 128
  gain: [number, number, number];
  contrast: number;
  // percentile stretch (sharp normalise); gentle and fixed
  normalise: { lower: number; upper: number };
  // shadows lift as a gamma on the whole image (sharp gamma, 1 = off). CLAHE
  // did this locally and better, and took 25 s on a 12-megapixel phone photo
  // on the production box (Plan/photo-retouch.md §13); gamma takes 0.1 s.
  shadowsGamma: number;
  // sharp modulate saturation multiplier (1 = unchanged)
  saturation: number;
  // unsharp mask sigma, 0 = off
  sharpenSigma: number;
  mono: boolean;
}

// Full-range reach of each control, chosen on real photos (Plan/photo-retouch.md
// §6): exposure +-35 %, white balance +-12 % per channel, contrast +-30 %.
const EXPOSURE_RANGE = 0.35;
const TEMPERATURE_RANGE = 0.12;
const TINT_RANGE = 0.08;
const CONTRAST_RANGE = 0.3;
const SATURATION_RANGE = 0.3;
// gamma 1.6 at full reach: mid-tones up a third of a stop, blacks stay black
const SHADOWS_RANGE = 0.6;

export const pipelineFor = (
  spec: RetouchSpec,
  level: RetouchLevel
): RetouchPipeline => {
  const s = clampSpec(spec, level);
  const exposure = 1 + s.exposure * EXPOSURE_RANGE;
  const r = 1 + s.temperature * TEMPERATURE_RANGE;
  const b = 1 - s.temperature * TEMPERATURE_RANGE;
  const g = 1 - s.tint * TINT_RANGE;
  return {
    gain: [
      round(r * exposure),
      round(g * exposure),
      round(b * exposure),
    ],
    contrast: round(1 + s.contrast * CONTRAST_RANGE),
    normalise: { lower: 0.2, upper: 99.8 },
    shadowsGamma: s.shadows > 0.1 ? round(1 + SHADOWS_RANGE * s.shadows) : 1,
    saturation: level === 'bw' ? 1 : round(1 + s.saturation * SATURATION_RANGE),
    sharpenSigma: s.sharpen > 0.05 ? round(0.5 + s.sharpen) : 0,
    mono: level === 'bw',
  };
};

const round = (v: number) => Math.round(v * 1000) / 1000;

/** What the pipeline measured on the source, for the fallback decision. */
export interface RetouchMeasure {
  // channel means 0..255
  means: [number, number, number];
}

/**
 * The decision without a model: what to do when AI is unavailable, so a
 * retouch never fails because OpenAI is down. Deliberately timid - a blind
 * white-balance guess turned a blue sea pink on the proof of concept, so the
 * colour move is tiny and only the exposure gets a real correction.
 */
export const heuristicSpec = (
  measure: RetouchMeasure,
  level: RetouchLevel
): RetouchSpec => {
  const [r, g, b] = measure.means;
  const grey = (r + g + b) / 3 / 255;
  // mid-tones at ~0.45 read as "normal"; move a fraction of the gap
  const exposure = clamp((0.45 - grey) / 0.45, -1, 1) * 0.6;
  // blue cast -> warm a little, red cast -> cool a little (tiny on purpose)
  const temperature = clamp((b - r) / 255, -1, 1) * 0.25;
  return clampSpec(
    {
      exposure,
      contrast: 0.2,
      temperature,
      tint: 0,
      shadows: level === 'light' ? 0 : 0.3,
      saturation: 0.15,
      sharpen: 0.3,
      summary:
        'Balanced the exposure and contrast with a light touch (AI was not available for this photo).',
    },
    level
  );
};

/** A plain sentence from the numbers, when the model gave no usable summary. */
export const describeSpec = (spec: RetouchSpec, level: RetouchLevel): string => {
  const parts: string[] = [];
  const say = (v: number, neg: string, pos: string, min = 0.08) => {
    if (v <= -min) parts.push(neg);
    else if (v >= min) parts.push(pos);
  };
  say(spec.exposure, 'darkened slightly', 'brightened slightly');
  say(spec.contrast, 'softened the contrast', 'added contrast');
  say(spec.temperature, 'cooled the colours', 'warmed the colours');
  if (spec.shadows >= 0.1) parts.push('lifted the shadows');
  say(spec.saturation, 'muted the colours', 'boosted the colours');
  if (spec.sharpen >= 0.1) parts.push('sharpened');
  if (level === 'bw') parts.push('converted to black and white');
  if (!parts.length) return 'Already well balanced: only a gentle polish applied.';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
};
