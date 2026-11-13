// HEIC, the iPhone default, is not among the formats the uploader takes; the
// refusal says what to do with it rather than only listing what works.
const HEIC = ' For iPhone HEIC photos, export them as JPEG first.';

/** "image/*,video/mp4" in words a person uses, for the upload refusal. */
export const describeAllowed = (allowed: string) => {
  const kinds = allowed.split(',').map((t) => t.trim());
  const images = kinds.some((t) => t.startsWith('image/'));
  const videos = kinds.some((t) => t.startsWith('video/'));
  if (images && videos) return 'Upload an image or an MP4 video.' + HEIC;
  if (videos) return 'Upload an MP4 video.';
  if (images) return 'Upload an image (JPG, PNG, WebP or GIF).' + HEIC;
  return '';
};
