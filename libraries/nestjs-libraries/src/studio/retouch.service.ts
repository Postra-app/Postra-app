import { HttpException, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import sharp, { type Sharp } from 'sharp';
import { readFile } from 'fs/promises';
import { join, normalize } from 'path';
import { fetch } from 'undici';
import { fromBuffer as fileTypeFromBuffer } from '@gitroom/nestjs-libraries/upload/file.type';
import { parseChat } from '@gitroom/nestjs-libraries/openai/parse-chat';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import {
  RetouchLevel,
  RetouchMeasure,
  RetouchPipeline,
  RetouchSpec,
  RetouchSpecSchema,
  boundSpec,
  clampSpec,
  describeSpec,
  heuristicSpec,
  pipelineFor,
} from '@gitroom/nestjs-libraries/studio/retouch-spec';

// Cheapest vision model on the key; the photo goes in at 512 px with
// detail "low", so one decision is a few hundred input tokens.
const MODEL_VISION = 'gpt-4.1-mini';
const LIMIT_INPUT_PIXELS = 30_000_000;
// The working and output size: the longest edge, same cap as the web uploader
// (MAX_IMAGE_EDGE in new.uploader.tsx). Measured on the production t3.medium
// (Plan/photo-retouch.md §13): the passes take 2.7 s per megapixel with
// CLAHE and about 0.4 s per megapixel without it.
const MAX_EDGE = 2048;
// The uploader already caps images at 2048 px; this is the bytes cap for a
// source fetched back from the CDN.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const PREVIEW_EDGE = 512;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
  timeout: 60_000,
});

const LEVEL_BRIEF: Record<RetouchLevel, string> = {
  light:
    'LIGHT: the subtle pass a photographer gives every frame before delivery. Small values only; most controls stay at 0.',
  medium:
    'MEDIUM: a visible but natural polish. Correct what is clearly off (exposure, colour cast, flat contrast) and leave the rest.',
  strong:
    'STRONG: a confident edit for social media. Fix exposure, open the shadows, add contrast and a little vibrance, but it must still read as the same real photo.',
  bw: 'BLACK AND WHITE: the photo will be converted to monochrome after your adjustments. Decide exposure, contrast, shadows and sharpening for a good black and white print; colour controls are ignored.',
};

// sharp refusing the input (over the pixel limit, truncated or corrupt
// bytes) is the caller's photo, not our bug: a 422 with a reason, not a 500.
const unreadable = (err: Error) => {
  const message = String(err?.message || '');
  if (/pixel limit|exceeds|Input buffer|Input file|corrupt|premature|unsupported|not a valid/i.test(message)) {
    return new HttpException(
      'This photo is too large or could not be read. Photos up to 30 megapixels in JPEG, PNG or WebP work.',
      422
    );
  }
  return err;
};

export interface RetouchResult {
  buffer: Buffer;
  spec: RetouchSpec;
  pipeline: RetouchPipeline;
  width: number;
  height: number;
  // true when the decision came from the heuristic, not the model
  fallback: boolean;
}

/**
 * Apply a pipeline to the bytes of a photo. Pure: the same bytes, spec and
 * level always give the same output. Exported for tests and for "redo at
 * another level", which must not ask the model again.
 */
type Raw = { data: Buffer; info: { width: number; height: number; channels: 1 | 2 | 3 | 4 } };

// sharp applies its operations in one fixed internal order whatever the
// call order is, so "auto-levels, then exposure, then local contrast, then
// sharpen" has to be separate passes with raw pixels in between.
const pass = async (raw: Raw, fn: (img: Sharp) => Sharp): Promise<Raw> => {
  const { data, info } = await fn(
    sharp(raw.data, {
      raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels },
      limitInputPixels: LIMIT_INPUT_PIXELS,
    })
  )
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info: info as Raw['info'] };
};

export const applyRetouch = async (
  source: Buffer,
  pipeline: RetouchPipeline
): Promise<Buffer> => {
  // 1. orientation, the working size, no alpha (the maths is per RGB
  //    channel), gentle auto-levels. The web uploader already caps photos at
  //    2048 px; a 12-megapixel phone photo from the mobile app or the API is
  //    capped here the same way, or every pass below takes four times longer.
  const opened = await sharp(source, { limitInputPixels: LIMIT_INPUT_PIXELS })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .normalise({ lower: pipeline.normalise.lower, upper: pipeline.normalise.upper })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let raw: Raw = { data: opened.data, info: opened.info as Raw['info'] };

  // 2. white balance x exposure, then contrast around mid-grey:
  //    out = a * (gain * in - 128) + 128  ->  linear(a * gain, 128 * (1 - a))
  const a = pipeline.contrast;
  raw = await pass(raw, (img) =>
    img.linear(
      pipeline.gain.map((g) => g * a),
      pipeline.gain.map(() => 128 * (1 - a))
    )
  );

  // 3. shadows: a gamma lift, out = in ^ (1 / g). sharp's gamma(g) alone
  //    darkens by 1/g and brightens by g again (it exists to linearise a
  //    resize), so the lift is gamma(1, g): no darkening, brighten by g.
  //    Its own pass, sharp would run it before the linear step otherwise.
  if (pipeline.shadowsGamma > 1) {
    raw = await pass(raw, (img) => img.gamma(1, pipeline.shadowsGamma));
  }

  // 4. mono gets a touch of contrast back (greyscale reads flat)
  if (pipeline.mono) {
    raw = await pass(raw, (img) => img.greyscale());
    raw = await pass(raw, (img) => img.linear(1.08, -8));
  }

  // 5. saturation, sharpen and encode in one pass (sharp sharpens before it
  //    modulates; for these two the order does not matter). libjpeg, not
  //    mozjpeg: a third of the time for a tenth more bytes.
  let out = sharp(raw.data, {
    raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels },
    limitInputPixels: LIMIT_INPUT_PIXELS,
  });
  if (!pipeline.mono && pipeline.saturation !== 1) {
    out = out.modulate({ saturation: pipeline.saturation });
  }
  if (pipeline.sharpenSigma > 0) {
    out = out.sharpen({ sigma: pipeline.sharpenSigma, m1: 0.5, m2: 2 });
  }
  return out.jpeg({ quality: 90 }).toBuffer();
};

@Injectable()
export class RetouchService {
  private readonly logger = new Logger(RetouchService.name);

  /** Bytes of a library file: from disk on local storage, the CDN otherwise. */
  async loadSource(path: string): Promise<Buffer> {
    const frontend = process.env.FRONTEND_URL || '';
    const uploads = `${frontend}/uploads/`;
    const local =
      (process.env.STORAGE_PROVIDER || 'local') === 'local' &&
      !!process.env.UPLOAD_DIRECTORY &&
      path.startsWith(uploads);
    if (local) {
      const rel = normalize(path.slice(uploads.length)).replace(/^(\.\.(\/|\\|$))+/, '');
      const file = join(process.env.UPLOAD_DIRECTORY!, rel);
      if (!file.startsWith(normalize(process.env.UPLOAD_DIRECTORY!))) {
        throw new HttpException('Media not found', 404);
      }
      return readFile(file);
    }
    if (!(await isSafePublicHttpsUrl(path))) {
      throw new HttpException('Media not found', 404);
    }
    const res = await fetch(path, {
      // @ts-ignore undici option, not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new HttpException(`Could not read the photo (${res.status})`, 502);
    }
    if (Number(res.headers.get('content-length') || 0) > MAX_SOURCE_BYTES) {
      throw new HttpException('This photo is too large to retouch', 413);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_SOURCE_BYTES) {
      throw new HttpException('This photo is too large to retouch', 413);
    }
    return buffer;
  }

  /**
   * Look at the photo and decide the adjustments. Any failure of the model
   * (outage, refusal, unparsable answer) falls back to the heuristic: a
   * retouch must never fail because AI is down.
   */
  async decide(
    source: Buffer,
    level: RetouchLevel,
    orgId: string,
    fileName = ''
  ): Promise<{ spec: RetouchSpec; fallback: boolean; measure: RetouchMeasure }> {
    const base = sharp(source, { limitInputPixels: LIMIT_INPUT_PIXELS }).rotate();
    const stats = await base.clone().stats().catch((err: Error) => {
      throw unreadable(err);
    });
    const means = stats.channels.slice(0, 3).map((c) => c.mean) as [
      number,
      number,
      number,
    ];
    const measure: RetouchMeasure = { means };

    try {
      const preview = await base
        .clone()
        .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: 'inside' })
        .jpeg({ quality: 70 })
        .toBuffer();
      const parsed = (
        await parseChat(
          openai,
          {
            model: MODEL_VISION,
            messages: [
              { role: 'system', content: this.systemPrompt(level) },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `File: ${fileName.slice(0, 120) || 'photo'}. Channel means (0-255): red ${means[0].toFixed(0)}, green ${means[1].toFixed(0)}, blue ${means[2].toFixed(0)}. Level: ${level}.`,
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${preview.toString('base64')}`,
                      detail: 'low',
                    },
                  },
                ],
              },
            ],
            response_format: zodResponseFormat(RetouchSpecSchema, 'retouchSpec'),
          },
          { organizationId: orgId, engine: 'retouch' }
        )
      ).choices[0].message.parsed;
      const checked = RetouchSpecSchema.safeParse(parsed);
      if (!checked.success) throw new Error('model returned no spec');
      // stored uncapped: the level caps in pipelineFor, so a redo at a
      // stronger level can use the whole decision
      const spec = boundSpec(checked.data);
      if (!spec.summary) spec.summary = describeSpec(clampSpec(spec, level), level);
      return { spec, fallback: false, measure };
    } catch (err) {
      this.logger.warn(
        `Retouch decision fell back to the heuristic: ${(err as Error)?.message}`
      );
      return { spec: heuristicSpec(measure, level), fallback: true, measure };
    }
  }

  async retouchBytes(
    source: Buffer,
    level: RetouchLevel,
    orgId: string,
    // a spec decided earlier (redo at another level) skips the model
    presetSpec?: RetouchSpec,
    fileName = ''
  ): Promise<RetouchResult> {
    const detected = await fileTypeFromBuffer(source);
    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      throw new HttpException('Only JPEG, PNG and WebP photos can be retouched', 422);
    }
    const decided = presetSpec
      ? { spec: boundSpec(presetSpec), fallback: false }
      : await this.decide(source, level, orgId, fileName);
    const pipeline = pipelineFor(decided.spec, level);
    const buffer = await applyRetouch(source, pipeline).catch((err: Error) => {
      throw unreadable(err);
    });
    const meta = await sharp(buffer).metadata();
    return {
      buffer,
      spec: decided.spec,
      pipeline,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      fallback: decided.fallback,
    };
  }

  private systemPrompt(level: RetouchLevel) {
    return `You are the retoucher of a professional photographer. You look at one photo and decide the gentle, global adjustments a photographer makes to every frame before delivering it. You do not edit pixels; you only set controls.

Return every control as a number from -1 to 1 (shadows and sharpen 0 to 1), where 0 means "leave it as it is". Prefer small values. A photo that already looks good gets zeros and a summary saying so.

Rules:
- Keep it natural. The subject stays who they are, skin tones stay real, the scene keeps its own colours: a blue sea stays blue, a sunset stays warm, a night scene stays dark. Never "correct" a colour that belongs to the scene.
- temperature/tint only fix a real colour cast (grey or white things that are not grey or white).
- exposure fixes under- or over-exposure of the subject, not of the sky.
- shadows opens dark areas where detail is hidden; 0 when the dark areas are part of the look.
- saturation: small. Vivid is not better.
- sharpen: a little for soft phone photos, 0 for anything already crisp or noisy.
- ${LEVEL_BRIEF[level]}
- summary: one sentence of at most 25 words in plain English for the owner of the photo: what you changed and why. No marketing words, no long dashes.`;
  }
}
