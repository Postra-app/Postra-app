import { HttpException, Logger } from '@nestjs/common';
import { recordAiUsage } from '@gitroom/nestjs-libraries/services/ai-usage.record';

// Studio's "Remove background", done by Photoroom's Remove Background API
// (https://docs.photoroom.com/remove-background-api-basic-plan). It used to
// run a model in the browser, which needs eval and WebAssembly from blob:
// URLs, none of which the app's Content-Security-Policy allows; on the server
// it is one request, the same on every device, at commercial quality.

const logger = new Logger('BackgroundRemoval');

// Photoroom reads PNG, JPEG, WebP and HEIC up to 50 MB and 6000 px; Studio
// sends what is on its canvas, which the library already keeps at 2048 px.
export const BACKGROUND_REMOVAL_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const BACKGROUND_REMOVAL_MAX_BYTES = 25 * 1024 * 1024;

const apiBase = () =>
  (process.env.PHOTOROOM_API_URL || 'https://sdk.photoroom.com').replace(/\/+$/, '');

export const UNAVAILABLE =
  'Background removal is unavailable right now. Try again in a few minutes.';
export const UNREADABLE =
  'This image could not be read. Try a PNG, JPEG or WebP photo.';

/** The picture with its background removed, as a transparent PNG. */
export const removeBackground = async (
  bytes: Buffer,
  mime: string,
  organizationId: string
): Promise<Buffer> => {
  const key = process.env.PHOTOROOM_API_KEY;
  if (!key) {
    logger.error('[bg-remove] PHOTOROOM_API_KEY is not set');
    throw new HttpException(UNAVAILABLE, 503);
  }
  const form = new FormData();
  form.append('image_file', new Blob([new Uint8Array(bytes)], { type: mime }), 'image');

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/v1/segment`, {
      method: 'POST',
      headers: { 'x-api-key': key },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    logger.error(`[bg-remove] photoroom unreachable: ${(err as Error).name}`);
    throw new HttpException(UNAVAILABLE, 503);
  }

  if (!res.ok) {
    // Never the key; Photoroom's own reason, short.
    const detail = (await res.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
    logger.error(`[bg-remove] photoroom ${res.status} ${detail}`);
    // 400 is about the picture; 401/402 (no credits), 403, 429 and 5xx are
    // ours to fix, not the customer's.
    throw new HttpException(res.status === 400 ? UNREADABLE : UNAVAILABLE, res.status === 400 ? 422 : 503);
  }

  // Failed calls cost nothing at Photoroom, so only a result is metered.
  recordAiUsage({
    organizationId,
    engine: 'background-removal',
    model: 'photoroom-segment',
    unit: 'images',
    inputAmount: 1,
  });
  return Buffer.from(await res.arrayBuffer());
};
