import * as fabric from 'fabric';
import { averageColor } from './brand-colors';

/** What is actually behind an object: hide it for one frame, read the pixels
 *  it covers, put it back. Reading the composed canvas is the only honest
 *  answer - the background can be a photo, a gradient, or three overlapping
 *  shapes. Null when the pixels cannot be read. */
export const sampleBehind = (
  canvas: fabric.Canvas,
  object: fabric.FabricObject
): string | null => {
  const el = canvas.getElement();
  const ctx = el.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const rect = object.getBoundingRect();
  // getImageData reads the backing buffer, which on a retina screen holds two
  // device pixels per CSS pixel. Scaling by zoom alone read a quarter-sized
  // patch up and to the left of the object.
  const retina = el.width / (canvas.getWidth() || el.width);
  const scale = (canvas.getZoom() || 1) * retina;
  const x = Math.max(0, Math.round(rect.left * scale));
  const y = Math.max(0, Math.round(rect.top * scale));
  const w = Math.min(el.width - x, Math.round(rect.width * scale));
  const h = Math.min(el.height - y, Math.round(rect.height * scale));
  if (w <= 0 || h <= 0) return null;

  const wasVisible = object.visible;
  try {
    object.visible = false;
    canvas.renderAll();
    return averageColor(ctx.getImageData(x, y, w, h).data);
  } catch {
    // A photo served without CORS headers taints the canvas and reading it
    // throws. No reading is better than a wrong one.
    return null;
  } finally {
    object.visible = wasVisible;
    canvas.renderAll();
  }
};
