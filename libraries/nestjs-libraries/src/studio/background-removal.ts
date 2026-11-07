import { HttpException, Logger } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import { recordAiUsage } from '@gitroom/nestjs-libraries/services/ai-usage.record';
import { timer } from '@gitroom/helpers/utils/timer';

// Studio's "Remove background", done by Recraft's model through kie.ai
// (https://docs.kie.ai/market/recraft/remove-background), the same account
// and balance as AI video. It used to run a model in the browser, which needs
// eval and WebAssembly from blob: URLs, none of which the app's
// Content-Security-Policy allows; on the server it is one task, the same on
// every device.

const logger = new Logger('BackgroundRemoval');

export const KIE_BACKGROUND_MODEL = 'recraft/remove-background';

// What Studio may send: PNG, JPEG or WebP, as on its canvas.
export const BACKGROUND_REMOVAL_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const BACKGROUND_REMOVAL_MAX_BYTES = 25 * 1024 * 1024;

// kie.ai takes 256 to 4096 px a side, up to 16 megapixels and 5 MB.
const MIN_SIDE = 256;
const MAX_SIDE = 4096;
const MAX_PIXELS = 16_000_000;
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

export const UNAVAILABLE =
  'Background removal is unavailable right now. Try again in a few minutes.';
export const UNREADABLE =
  'This image could not be read. Try a PNG, JPEG or WebP photo.';
export const TOO_SMALL =
  'This image is too small to cut out. Use one at least 256 pixels on each side.';
export const TOO_NARROW =
  'This image is too long and narrow to cut out. Crop it closer to a square and try again.';

const kieUrl = (path: string) =>
  `${(process.env.KIEAI_API_URL || 'https://api.kie.ai').replace(/\/+$/, '')}${path}`;

const kieHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.KIEAI_API_KEY}`,
});

const parseJson = (value: unknown): any => {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || '{}')) || {};
  } catch {
    return {};
  }
};

/**
 * The picture as kie.ai accepts it: at most 4096 px a side and 16 megapixels,
 * at most 5 MB. A picture under 256 px a side is refused: the model needs
 * that much to find an edge, and enlarging it would only blur the cut.
 */
export const prepareInput = async (bytes: Buffer): Promise<Buffer> => {
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: 60_000_000 }).metadata();
  } catch {
    throw new HttpException(UNREADABLE, 422);
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new HttpException(UNREADABLE, 422);
  if (Math.min(width, height) < MIN_SIDE) throw new HttpException(TOO_SMALL, 422);

  const scale = Math.min(
    1,
    MAX_SIDE / Math.max(width, height),
    Math.sqrt(MAX_PIXELS / (width * height))
  );
  // A long, narrow picture brought down to 4096 px can end up under 256 px on
  // its short side, which the model refuses as well.
  if (Math.floor(Math.min(width, height) * scale) < MIN_SIDE) {
    throw new HttpException(TOO_NARROW, 422);
  }
  // Smaller steps until the file fits kie.ai's 5 MB: first the picture as
  // PNG, then as JPEG (the model looks at the picture, not its
  // transparency), then the JPEG at a smaller size, never under 256 px.
  const encode = (factor: number, jpeg: boolean) => {
    const w = Math.floor(width * scale * factor);
    const h = Math.floor(height * scale * factor);
    const p = sharp(bytes, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize(w, h);
    return jpeg
      ? p.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
      : p.png().toBuffer();
  };
  try {
    const png = await encode(1, false);
    if (png.length <= MAX_INPUT_BYTES) return png;
    for (let factor = 1; Math.min(width, height) * scale * factor >= MIN_SIDE; factor *= 0.8) {
      const jpeg = await encode(factor, true);
      if (jpeg.length <= MAX_INPUT_BYTES) return jpeg;
    }
  } catch {
    // Pixels that do not decode, behind a header that did.
    throw new HttpException(UNREADABLE, 422);
  }
  throw new HttpException(UNREADABLE, 422);
};

/** Where the finished cut-out is: `resultJson.resultUrls`, as documented. */
export const resultUrlOf = (record: any): string | undefined => {
  const list = parseJson(record?.resultJson)?.resultUrls;
  return Array.isArray(list)
    ? list.find((u: unknown): u is string => typeof u === 'string' && !!u)
    : undefined;
};

/**
 * Asks kie.ai to cut the picture at `imageUrl` out of its background and
 * returns the URL of the result (a file kie.ai keeps for a while; the caller
 * copies it into our storage). Polls every `pollMs`, up to `maxPolls` times.
 */
export const removeBackground = async (
  imageUrl: string,
  organizationId: string,
  { pollMs = 2_000, maxPolls = 45 } = {}
): Promise<string> => {
  if (!process.env.KIEAI_API_KEY) {
    logger.error('[bg-remove] KIEAI_API_KEY is not set');
    throw new HttpException(UNAVAILABLE, 503);
  }

  let created: any;
  try {
    created = await (
      await fetch(kieUrl('/api/v1/jobs/createTask'), {
        method: 'POST',
        headers: kieHeaders(),
        body: JSON.stringify({ model: KIE_BACKGROUND_MODEL, input: { image: imageUrl } }),
        signal: AbortSignal.timeout(30_000),
      })
    ).json();
  } catch (err) {
    logger.error(`[bg-remove] kie.ai unreachable: ${(err as Error).name}`);
    throw new HttpException(UNAVAILABLE, 503);
  }
  if (created?.code !== 200 || !created?.data?.taskId) {
    // 401/402/429: key, balance or rate, ours to fix and not the customer's.
    logger.error(`[bg-remove] kie.ai createTask refused: ${created?.code} ${created?.msg}`);
    throw new HttpException(UNAVAILABLE, 503);
  }

  const taskId = created.data.taskId;
  for (let poll = 0; poll < maxPolls; poll++) {
    await timer(pollMs);
    let info: any;
    try {
      info = await (
        await fetch(kieUrl(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`), {
          headers: kieHeaders(),
          signal: AbortSignal.timeout(15_000),
        })
      ).json();
    } catch {
      continue;
    }
    if (info?.code !== 200) continue;
    const state = info?.data?.state;
    if (state === 'fail') {
      logger.warn(`[bg-remove] kie.ai task ${taskId} failed: ${info.data.failCode} ${info.data.failMsg}`);
      throw new HttpException(UNREADABLE, 422);
    }
    if (state === 'success') {
      const url = resultUrlOf(info.data);
      if (!url) {
        logger.error(`[bg-remove] kie.ai task ${taskId} finished without a result URL`);
        throw new HttpException(UNAVAILABLE, 503);
      }
      // Paid at kie.ai once a result exists; a failed task costs nothing.
      recordAiUsage({
        organizationId,
        engine: 'background-removal',
        model: 'recraft-remove-background',
        unit: 'images',
        inputAmount: 1,
      });
      return url;
    }
  }
  logger.error(`[bg-remove] kie.ai task ${taskId} timed out`);
  throw new HttpException(UNAVAILABLE, 503);
};
