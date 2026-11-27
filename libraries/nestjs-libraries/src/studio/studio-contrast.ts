import {
  StudioLayer,
  StudioPatch,
  StudioSpec,
  StudioTextLayer,
} from '@gitroom/nestjs-libraries/studio/studio-spec';

// E2E-11-477: AI Refine "Stronger CTA" made the button text the same red as
// the button. The model is asked for readable text (the Refine prompt), and
// this makes sure of it: a text colour the patch sets that reads at less than
// 3:1 against what is under the text (WCAG 2.2 1.4.3 for large text, the
// floor any design text should clear) becomes white or black, whichever
// reads better there.
export const MIN_TEXT_CONTRAST = 3;

type Rgb = [number, number, number];

export const parseHex = (value?: string | null): Rgb | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((value ?? '').trim());
  if (!m) return null;
  const hex =
    m[1].length === 3
      ? m[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
};

// WCAG relative luminance and contrast ratio.
const luminance = ([r, g, b]: Rgb) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export const contrastRatio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The layer's box on the canvas, from its anchor point and origin.
const box = (layer: StudioLayer) => {
  const w = layer.width ?? 0;
  const h = layer.height ?? 0;
  const left =
    layer.originX === 'center' ? layer.x - w / 2 : layer.originX === 'right' ? layer.x - w : layer.x;
  const top =
    layer.originY === 'center' ? layer.y - h / 2 : layer.originY === 'bottom' ? layer.y - h : layer.y;
  return { left, top, w, h };
};

const centre = (layer: StudioLayer) => {
  const b = box(layer);
  return { x: b.left + b.w / 2, y: b.top + b.h / 2 };
};

// The solid colour under a point: the topmost visible, mostly opaque shape
// with a plain hex fill below the text that contains it, else the canvas.
// Anything else under the text (a photo, a gradient) is not judged.
const colourUnder = (spec: StudioSpec, textIndex: number): Rgb | null => {
  const point = centre(spec.layers[textIndex]);
  for (let i = textIndex - 1; i >= 0; i--) {
    const layer = spec.layers[i];
    if (layer.hidden || (layer.opacity ?? 1) < 0.6) continue;
    const b = box(layer);
    const inside =
      b.w > 0 &&
      b.h > 0 &&
      point.x >= b.left &&
      point.x <= b.left + b.w &&
      point.y >= b.top &&
      point.y <= b.top + b.h;
    if (!inside) continue;
    if (layer.kind === 'image' || layer.kind === 'text') return null;
    if (layer.kind === 'line' || layer.kind === 'path') continue;
    return parseHex((layer as { fill?: string }).fill);
  }
  return parseHex(spec.background);
};

const readableOn = (under: Rgb) =>
  contrastRatio([255, 255, 255], under) >= contrastRatio([0, 0, 0], under)
    ? '#ffffff'
    : '#000000';

/**
 * The patch with every text colour it sets made readable against what will
 * be under that text once the patch is applied. `apply` is the patch
 * applier (applyPatch), passed in so this stays a pure function.
 */
export function keepTextReadable(
  spec: StudioSpec,
  patch: StudioPatch,
  apply: (spec: StudioSpec, patch: StudioPatch) => StudioSpec
): { patch: StudioPatch; fixed: string[] } {
  const next = apply(spec, patch);
  const fixed: string[] = [];
  const ops = patch.ops.map((op) => {
    const id =
      op.op === 'update' ? op.id : op.op === 'add' ? op.layer.id : undefined;
    const colour =
      op.op === 'update'
        ? (op.props as Partial<StudioTextLayer>).color
        : op.op === 'add' && op.layer.kind === 'text'
        ? op.layer.color
        : undefined;
    if (!id || colour === undefined) return op;
    const index = next.layers.findIndex((l) => l.id === id);
    if (index < 0 || next.layers[index].kind !== 'text') return op;
    const text = parseHex(colour);
    const under = colourUnder(next, index);
    if (!text || !under || contrastRatio(text, under) >= MIN_TEXT_CONTRAST) {
      return op;
    }
    const readable = readableOn(under);
    fixed.push(id);
    if (op.op === 'update') {
      return { ...op, props: { ...op.props, color: readable } };
    }
    if (op.op === 'add') {
      return { ...op, layer: { ...op.layer, color: readable } as StudioLayer };
    }
    return op;
  });
  return { patch: { ...patch, ops }, fixed };
}
