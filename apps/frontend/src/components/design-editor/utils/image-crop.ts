/**
 * Manual cropping.
 *
 * Fabric draws an image as a window onto its source: `cropX`/`cropY` say where
 * the window starts, `width`/`height` how much of the source it shows, and the
 * scale how big that window is drawn. Cropping is therefore not a destructive
 * edit — it moves the window — which is why a crop can be widened again later.
 *
 * `fabric/extensions/cropping_controls` ships the same idea, but as raw
 * TypeScript inside node_modules, which the Next build does not transpile.
 * The arithmetic is small enough to own, and owning it makes it testable.
 */

export interface CroppableImage {
  /** Top-left of the drawn image, in canvas coordinates. */
  left: number;
  top: number;
  /** Source pixels currently shown. */
  width: number;
  height: number;
  cropX: number;
  cropY: number;
  scaleX: number;
  scaleY: number;
  /** Full source size, the hard limit for any crop. */
  sourceWidth: number;
  sourceHeight: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CropResult {
  cropX: number;
  cropY: number;
  width: number;
  height: number;
  left: number;
  top: number;
}

/** Never let a crop collapse to nothing — an image with zero width cannot be
 *  grabbed again to undo the mistake. */
const MIN_CROP_PX = 8;

/** Turn a frame drawn on the canvas into the source-pixel window it selects.
 *  The frame is clamped to the image, so dragging past an edge crops to the
 *  edge instead of showing empty space. */
export const cropFromRect = (image: CroppableImage, rect: Rect): CropResult => {
  const scaleX = image.scaleX || 1;
  const scaleY = image.scaleY || 1;

  // Frame, in the source pixels of the image as it is currently cropped.
  const rawX = (rect.left - image.left) / scaleX;
  const rawY = (rect.top - image.top) / scaleY;
  const rawW = rect.width / scaleX;
  const rawH = rect.height / scaleY;

  const offsetX = Math.min(Math.max(0, rawX), Math.max(0, image.width - MIN_CROP_PX));
  const offsetY = Math.min(Math.max(0, rawY), Math.max(0, image.height - MIN_CROP_PX));

  const width = Math.max(MIN_CROP_PX, Math.min(rawW + Math.min(0, rawX), image.width - offsetX));
  const height = Math.max(MIN_CROP_PX, Math.min(rawH + Math.min(0, rawY), image.height - offsetY));

  const cropX = Math.min(image.cropX + offsetX, Math.max(0, image.sourceWidth - width));
  const cropY = Math.min(image.cropY + offsetY, Math.max(0, image.sourceHeight - height));

  return {
    cropX: Math.round(cropX),
    cropY: Math.round(cropY),
    width: Math.round(width),
    height: Math.round(height),
    // The cropped image sits where the frame was, minus whatever the clamp
    // trimmed off the left or top.
    left: image.left + offsetX * scaleX,
    top: image.top + offsetY * scaleY,
  };
};

/** Undo every crop: show the whole source again, keeping the top-left corner
 *  where it is so the design does not jump. */
export const resetCrop = (image: CroppableImage): CropResult => ({
  cropX: 0,
  cropY: 0,
  width: image.sourceWidth,
  height: image.sourceHeight,
  left: image.left,
  top: image.top,
});

/** A starting frame for the crop tool: the middle 80% of what is shown, so the
 *  handles are visible and inside the image. */
export const initialCropRect = (image: CroppableImage): Rect => {
  const drawnW = image.width * (image.scaleX || 1);
  const drawnH = image.height * (image.scaleY || 1);
  return {
    left: image.left + drawnW * 0.1,
    top: image.top + drawnH * 0.1,
    width: drawnW * 0.8,
    height: drawnH * 0.8,
  };
};

/** Swapping the photo in a template must keep the frame the designer chose:
 *  same box, same crop window, new pixels. Returns the scale and crop that
 *  make a new source fill the old box, centred (a "cover" fit). */
export const fitReplacement = (
  target: { width: number; height: number; scaleX: number; scaleY: number },
  source: { width: number; height: number }
): { scaleX: number; scaleY: number; cropX: number; cropY: number; width: number; height: number } => {
  const boxW = target.width * (target.scaleX || 1);
  const boxH = target.height * (target.scaleY || 1);
  if (!source.width || !source.height || !boxW || !boxH) {
    return {
      scaleX: target.scaleX || 1,
      scaleY: target.scaleY || 1,
      cropX: 0,
      cropY: 0,
      width: source.width,
      height: source.height,
    };
  }
  // Cover: the scale is set by whichever axis needs the most magnification,
  // and the overflow on the other axis becomes the crop.
  const scale = Math.max(boxW / source.width, boxH / source.height);
  const visibleW = Math.min(source.width, boxW / scale);
  const visibleH = Math.min(source.height, boxH / scale);
  return {
    scaleX: scale,
    scaleY: scale,
    cropX: Math.round((source.width - visibleW) / 2),
    cropY: Math.round((source.height - visibleH) / 2),
    width: Math.round(visibleW),
    height: Math.round(visibleH),
  };
};
