'use client';

import * as fabric from 'fabric';
import { fitReplacement } from './image-crop';

let cachedModule: typeof import('@imgly/background-removal') | null = null;

const getModule = async () => {
  if (cachedModule) return cachedModule;
  cachedModule = await import('@imgly/background-removal');
  return cachedModule;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export interface RemoveBgOptions {
  onProgress?: (progress: number) => void;
}

const isWebGpuAvailable = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { gpu?: unknown };
  return Boolean(nav.gpu);
};

export const removeBackgroundFromImage = async (
  imgEl: HTMLImageElement,
  options: RemoveBgOptions = {}
): Promise<string> => {
  const mod = await getModule();
  const blob = await mod.removeBackground(imgEl.src, {
    device: isWebGpuAvailable() ? 'gpu' : 'cpu',
    output: { format: 'image/png' },
    progress: options.onProgress
      ? (key, current, total) => {
          if (total > 0) options.onProgress!(current / total);
        }
      : undefined,
  });
  return blobToDataUrl(blob);
};

/**
 * 'stretch' keeps the old behaviour: the new pixels are squeezed into the box
 * whatever their aspect ratio (right for a background removal, which returns
 * the same picture). 'cover' fills the box and crops the overflow, which is
 * what swapping the photo inside a template needs — a portrait photo dropped
 * into a landscape frame must not turn into a squashed portrait.
 */
export const replaceImageOnCanvas = async (
  canvas: fabric.Canvas,
  targetImage: fabric.FabricImage,
  newSrc: string,
  fit: 'stretch' | 'cover' = 'stretch'
): Promise<void> => {
  const imgEl = new Image();
  imgEl.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    imgEl.onload = () => resolve();
    imgEl.onerror = () => reject(new Error('image load failed'));
    imgEl.src = newSrc;
  });

  const replacement = new fabric.FabricImage(imgEl);
  const sourceWidth = imgEl.naturalWidth || imgEl.width || 1;
  const sourceHeight = imgEl.naturalHeight || imgEl.height || 1;
  const cover =
    fit === 'cover'
      ? fitReplacement(
          {
            width: targetImage.width || 1,
            height: targetImage.height || 1,
            scaleX: targetImage.scaleX || 1,
            scaleY: targetImage.scaleY || 1,
          },
          { width: sourceWidth, height: sourceHeight }
        )
      : null;
  replacement.set({
    left: targetImage.left,
    top: targetImage.top,
    ...(cover
      ? {
          scaleX: cover.scaleX,
          scaleY: cover.scaleY,
          cropX: cover.cropX,
          cropY: cover.cropY,
          width: cover.width,
          height: cover.height,
        }
      : {
          scaleX: ((targetImage.width || 1) * (targetImage.scaleX || 1)) / sourceWidth,
          scaleY: ((targetImage.height || 1) * (targetImage.scaleY || 1)) / sourceHeight,
        }),
    angle: targetImage.angle,
    originX: targetImage.originX,
    originY: targetImage.originY,
    selectable: true,
    evented: true,
    hasControls: true,
    hasBorders: true,
  });

  canvas.remove(targetImage);
  canvas.add(replacement);
  canvas.setActiveObject(replacement);
  canvas.renderAll();
};
