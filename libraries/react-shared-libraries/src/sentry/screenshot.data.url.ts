// The feedback widget hands its screenshot over as raw bytes labelled
// "application/png", which the backend rightly refuses as an image type. The
// canvas always produces a PNG, so the type is read from the bytes instead.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const imageType = (bytes: Uint8Array) => {
  if (PNG.every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return undefined;
};

export const screenshotDataUrl = (a?: { data: string | Uint8Array }) => {
  if (!a || typeof a.data === 'string') return undefined;
  const type = imageType(a.data);
  if (!type) return undefined;
  let bin = '';
  for (let i = 0; i < a.data.length; i += 0x8000) {
    bin += String.fromCharCode(...a.data.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(bin)}`;
};
