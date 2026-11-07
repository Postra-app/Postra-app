/**
 * Photos from a camera or a high-quality phone export run to 20-40 MB, past
 * the upload limit, and a design is 1080-1920 px wide. Like the composer's
 * uploader, Studio brings a photo down to MAX_DESIGN_IMAGE_EDGE on its longest
 * side before it is uploaded. PNG stays PNG (transparency), the rest becomes
 * JPEG; GIF and SVG, and anything the browser cannot decode, go up as they are.
 */
export const MAX_DESIGN_IMAGE_EDGE = 2048;

const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Size of the longest-side-capped image, or null when it already fits. */
export const fitWithin = (
  width: number,
  height: number,
  maxEdge = MAX_DESIGN_IMAGE_EDGE
): { width: number; height: number } | null => {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

export const downscaleForDesign = async (file: File): Promise<File> => {
  if (!RESIZABLE.has(file.type) || typeof createImageBitmap !== 'function') return file;
  // createImageBitmap applies the photo's EXIF orientation, as <img> does.
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    if (!size) return file;
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, 0.9)
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg');
    return new File([blob], name, { type });
  } finally {
    bitmap.close();
  }
};
