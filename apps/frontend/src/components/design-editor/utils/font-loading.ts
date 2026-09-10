/**
 * Fonts have to be in the document BEFORE Fabric measures text with them.
 *
 * Fabric measures a text object once, caches the metrics on the object, and
 * reuses them for the rest of the session. A @font-face that is still
 * downloading when the object is created gets measured in the fallback font —
 * Playfair Display laid out with Georgia's widths — and the wrong line breaks
 * survive every later render, including the export. The only fix is to wait for
 * the family, then tell the existing objects to measure themselves again.
 */

/** Object shape we need; keeps these helpers testable without Fabric. */
interface MeasurableText {
  type?: string;
  fontFamily?: string;
  initDimensions?: () => void;
  setCoords?: () => void;
}

/** First family of a CSS stack, quoted the way `FontFaceSet.load` expects.
 *  `"Open Sans", sans-serif` → `"Open Sans"`; `Geist, system-ui` → `Geist`. */
export const primaryFamily = (stack: string): string => {
  const first = stack.split(',')[0]?.trim() ?? '';
  const bare = first.replace(/^["']|["']$/g, '');
  if (!bare) return '';
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(bare) ? bare : `"${bare}"`;
};

/** The specifiers to ask for. Fabric only ever draws normal and bold, so two
 *  per family is the whole set — asking for weights we never draw would delay
 *  the first paint for nothing. */
export const fontSpecifiers = (stack: string, size = 16): string[] => {
  const family = primaryFamily(stack);
  if (!family) return [];
  return [`400 ${size}px ${family}`, `700 ${size}px ${family}`];
};

/** Families actually used by objects on a canvas, deduplicated. */
export const familiesInUse = (objects: MeasurableText[]): string[] => {
  const seen = new Set<string>();
  for (const o of objects) {
    const family = typeof o.fontFamily === 'string' ? o.fontFamily.trim() : '';
    if (family) seen.add(family);
  }
  return [...seen];
};

/** Generic families are always available and are not loadable faces. */
const GENERIC = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
]);

export const ensureFontsLoaded = async (
  stacks: string[],
  fonts: FontFaceSet | undefined = typeof document === 'undefined'
    ? undefined
    : document.fonts
): Promise<void> => {
  if (!fonts?.load) return;
  const specifiers = stacks
    .filter((s) => !GENERIC.has(primaryFamily(s).replace(/"/g, '')))
    .flatMap((s) => fontSpecifiers(s));
  if (!specifiers.length) return;
  // A face the browser cannot fetch rejects; one missing font must not stop the
  // others from arriving, and it must never break adding text.
  await Promise.all(specifiers.map((spec) => fonts.load(spec).catch(() => [])));
};

/** Drop the cached metrics of every text object so the freshly arrived family
 *  is the one that decides the line breaks. */
export const remeasureText = (objects: MeasurableText[]): number => {
  let touched = 0;
  for (const o of objects) {
    if (typeof o.initDimensions !== 'function') continue;
    o.initDimensions();
    o.setCoords?.();
    touched++;
  }
  return touched;
};

interface FontAwareCanvas {
  getObjects: () => MeasurableText[];
  requestRenderAll: () => void;
}

/** Load every family a canvas uses, then re-measure. Call it after anything
 *  that puts text on the canvas in bulk: a template, a restored draft, an AI
 *  design, an off-screen canvas built for export. */
export const loadCanvasFonts = async (canvas: FontAwareCanvas): Promise<void> => {
  const objects = canvas.getObjects();
  const families = familiesInUse(objects);
  if (!families.length) return;
  await ensureFontsLoaded(families);
  if (remeasureText(objects)) canvas.requestRenderAll();
};
