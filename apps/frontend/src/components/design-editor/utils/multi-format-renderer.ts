import * as fabric from 'fabric';
import { PLATFORM_SIZES, PlatformSize } from '../editor.store';
import { loadCanvasFonts } from './font-loading';
import { stampPlatform } from './canvas-format';

export interface FormatRender {
  platform: PlatformSize;
  /** Lossless, for the download and the ZIP. */
  dataUrl: string;
  /** What gets uploaded. Seven 1080x1920 PNGs regularly ran past the 10MB
   *  upload cap and came back as a generic "Rendering failed"; every other
   *  export path in Studio uploads JPEG for exactly this reason. */
  uploadDataUrl: string;
  canvasJson?: string;
}

const BG_COVERAGE_THRESHOLD = 0.5;
const EDGE_ANCHOR_RATIO = 0.25;

type Anchor = 'start' | 'center' | 'end';

interface PositionAnchors {
  x: Anchor;
  y: Anchor;
}

const detectAnchor = (
  pos: number,
  size: number,
  bounds: number
): Anchor => {
  const center = pos + size / 2;
  const rel = center / bounds;
  if (rel < EDGE_ANCHOR_RATIO) return 'start';
  if (rel > 1 - EDGE_ANCHOR_RATIO) return 'end';
  return 'center';
};

/** How far from a corner a background may start, as a share of the canvas. */
const BG_EDGE_TOLERANCE = 0.05;

/**
 * Is this object the backdrop, to be re-cropped to cover the new format?
 *
 * Area alone was not enough: a template's big content card covers more than
 * half the canvas, and stretching it to cover the frame wrecked the layout.
 * A real background also starts at a corner and reaches the far edges.
 */
export const isBackgroundBox = (
  box: { left: number; top: number; width: number; height: number },
  srcW: number,
  srcH: number
): boolean => {
  if (box.width * box.height < srcW * srcH * BG_COVERAGE_THRESHOLD) return false;
  const tolX = srcW * BG_EDGE_TOLERANCE;
  const tolY = srcH * BG_EDGE_TOLERANCE;
  return (
    box.left <= tolX &&
    box.top <= tolY &&
    box.left + box.width >= srcW - tolX &&
    box.top + box.height >= srcH - tolY
  );
};

const isBackground = (
  obj: fabric.Object,
  srcW: number,
  srcH: number
): boolean => isBackgroundBox(getEdges(obj), srcW, srcH);

const getEdges = (obj: fabric.Object) => {
  const w = (obj.width || 0) * (obj.scaleX || 1);
  const h = (obj.height || 0) * (obj.scaleY || 1);
  const oX = obj.originX || 'left';
  const oY = obj.originY || 'top';

  let edgeLeft = obj.left || 0;
  if (oX === 'center') edgeLeft -= w / 2;
  else if (oX === 'right') edgeLeft -= w;

  let edgeTop = obj.top || 0;
  if (oY === 'center') edgeTop -= h / 2;
  else if (oY === 'bottom') edgeTop -= h;

  return { left: edgeLeft, top: edgeTop, width: w, height: h };
};

const applyEdges = (
  obj: fabric.Object,
  edgeLeft: number,
  edgeTop: number,
  width: number,
  height: number
) => {
  const oX = obj.originX || 'left';
  const oY = obj.originY || 'top';

  let finalLeft = edgeLeft;
  if (oX === 'center') finalLeft += width / 2;
  else if (oX === 'right') finalLeft += width;

  let finalTop = edgeTop;
  if (oY === 'center') finalTop += height / 2;
  else if (oY === 'bottom') finalTop += height;

  obj.set({ left: finalLeft, top: finalTop });
  // Fabric caches each object's corner coordinates and skips rendering anything
  // it believes sits outside the viewport. `set` does not refresh that cache, so
  // after a move onto a shorter canvas the stale corners still read as
  // off-frame and the layer is silently dropped from the render — which is how
  // a promo template lost its call-to-action button on the way from 4:5 to 1:1.
  obj.setCoords();
};

export const repositionObjectFromTo = (
  obj: fabric.Object,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): void => {
  const bounds = getEdges(obj);

  if (isBackground(obj, srcW, srcH)) {
    const coverScale = Math.max(dstW / bounds.width, dstH / bounds.height);
    obj.set({
      scaleX: (obj.scaleX || 1) * coverScale,
      scaleY: (obj.scaleY || 1) * coverScale,
    });
    const newW = bounds.width * coverScale;
    const newH = bounds.height * coverScale;
    applyEdges(obj, (dstW - newW) / 2, (dstH - newH) / 2, newW, newH);
    return;
  }

  // Short-side ratio, NOT min(dstW/srcW, dstH/srcH): the min of two axis
  // ratios loses size on every aspect-ratio change and never gains it back,
  // so clicking through the format bar shrank text until it vanished. A ratio
  // of single measures is invertible — a round trip restores the original
  // size. Capped so the element can never outgrow the destination canvas.
  const fitCap = Math.min(
    bounds.width > 0 ? dstW / bounds.width : Infinity,
    bounds.height > 0 ? dstH / bounds.height : Infinity
  );
  const uniformScale = Math.min(
    Math.min(dstW, dstH) / Math.min(srcW, srcH),
    fitCap
  );
  const newW = bounds.width * uniformScale;
  const newH = bounds.height * uniformScale;

  const anchors: PositionAnchors = {
    x: detectAnchor(bounds.left, bounds.width, srcW),
    y: detectAnchor(bounds.top, bounds.height, srcH),
  };

  // A layer that is neither hugging an edge keeps its place RELATIVE to the
  // frame; it is not snapped to the exact middle. Snapping was the old
  // behaviour and it collapsed stacked layouts: a headline at 45% down and the
  // line under it at 70% down both landed dead centre and printed on top of
  // each other, and because the result is autosaved, the ruined design came
  // back after a reload with nothing left to undo. Mapping the centre through
  // the same ratio keeps the gap between them, and stays reversible — one
  // measure in, one measure out, so a round trip lands where it started.
  const centreOf = (start: number, size: number, src: number, dst: number) =>
    ((start + size / 2) / src) * dst;

  let newEdgeLeft: number;
  if (anchors.x === 'start') {
    newEdgeLeft = (bounds.left / srcW) * dstW;
  } else if (anchors.x === 'end') {
    const rightPad = srcW - (bounds.left + bounds.width);
    newEdgeLeft = dstW - newW - (rightPad / srcW) * dstW;
  } else {
    newEdgeLeft = centreOf(bounds.left, bounds.width, srcW, dstW) - newW / 2;
  }

  let newEdgeTop: number;
  if (anchors.y === 'start') {
    newEdgeTop = (bounds.top / srcH) * dstH;
  } else if (anchors.y === 'end') {
    const bottomPad = srcH - (bounds.top + bounds.height);
    newEdgeTop = dstH - newH - (bottomPad / srcH) * dstH;
  } else {
    newEdgeTop = centreOf(bounds.top, bounds.height, srcH, dstH) - newH / 2;
  }

  obj.set({
    scaleX: (obj.scaleX || 1) * uniformScale,
    scaleY: (obj.scaleY || 1) * uniformScale,
  });
  applyEdges(obj, newEdgeLeft, newEdgeTop, newW, newH);
};

export const renderCanvasAtSize = async (
  canvasJson: string,
  srcW: number,
  srcH: number,
  target: PlatformSize
): Promise<{ dataUrl: string; uploadDataUrl: string; canvasJson: string }> => {
  const el = document.createElement('canvas');
  el.width = target.width;
  el.height = target.height;

  const c = new fabric.StaticCanvas(el, {
    width: target.width,
    height: target.height,
    backgroundColor: '#1a1a2e',
    enableRetinaScaling: false,
  });

  await c.loadFromJSON(canvasJson);
  // Exports run on a throw-away canvas of their own. Without this the
  // resized formats are measured in the fallback font and the text wraps
  // differently from what the user approved on screen.
  await loadCanvasFonts(c);

  c.getObjects().forEach((obj) =>
    repositionObjectFromTo(obj, srcW, srcH, target.width, target.height)
  );

  c.renderAll();
  const dataUrl = c.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
  const uploadDataUrl = c.toDataURL({ format: 'jpeg', quality: 0.92, multiplier: 1 });
  // Each rendered format is saved as its own design, so it carries the format
  // it was rendered for — reopening the IG Story version must not draw it in
  // the format the editor happens to be on.
  const repositionedJson = stampPlatform(JSON.stringify(c.toJSON()), target);
  c.dispose();
  return { dataUrl, uploadDataUrl, canvasJson: repositionedJson };
};

export const renderAllFormats = async (
  canvasJson: string,
  srcW: number,
  srcH: number,
  onProgress?: (done: number, total: number) => void
): Promise<FormatRender[]> => {
  const targets = PLATFORM_SIZES.filter((p) => p.key !== 'custom');
  const results: FormatRender[] = [];

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    // eslint-disable-next-line no-await-in-loop
    const { dataUrl, uploadDataUrl, canvasJson: repositioned } =
      await renderCanvasAtSize(canvasJson, srcW, srcH, target);
    results.push({
      platform: target,
      dataUrl,
      uploadDataUrl,
      canvasJson: repositioned,
    });
    onProgress?.(i + 1, targets.length);
  }

  return results;
};

export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const res = await window.fetch(dataUrl);
  return res.blob();
};
