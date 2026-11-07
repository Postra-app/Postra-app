'use client';

import * as fabric from 'fabric';
import { fitReplacement, keepWidthScale } from './image-crop';

const imageToBlob = (imgEl: HTMLImageElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth || imgEl.width;
    canvas.height = imgEl.naturalHeight || imgEl.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('no 2d context'));
    ctx.drawImage(imgEl, 0, 0);
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('image could not be read'))),
      'image/png'
    );
  });

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Why the server refused, in its own words, for the toast. */
export class BackgroundRemovalError extends Error {}

/**
 * The picture on the canvas, sent as it looks now (a crop included), comes
 * back with a transparent background as a new file in the media library.
 * The work is done on the server: the model that used to run in the browser
 * needs eval and blob: scripts, which the app's policy rightly refuses.
 */
export const removeBackgroundFromImage = async (
  imgEl: HTMLImageElement,
  fetch: Fetch
): Promise<string> => {
  const body = new FormData();
  body.append('file', await imageToBlob(imgEl), 'image.png');
  const res = await fetch('/media/remove-background', { method: 'POST', body });
  if (!res.ok) {
    const message = await res
      .json()
      .then((b: { message?: unknown }) => (typeof b?.message === 'string' ? b.message : ''))
      .catch(() => '');
    throw new BackgroundRemovalError(message);
  }
  const { path } = (await res.json()) as { path: string };
  return path;
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
  fit: 'stretch' | 'cover' | 'width' = 'stretch'
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
      : fit === 'width'
      ? (() => {
          // A picture in new proportions (a smart crop): same width on the
          // canvas, its own height, never stretched.
          const scale = keepWidthScale(
            (targetImage.width || 1) * (targetImage.scaleX || 1),
            sourceWidth
          );
          return { scaleX: scale, scaleY: scale };
        })()
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
