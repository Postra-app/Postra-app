import { Injectable } from '@nestjs/common';
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import {
  PostDesignSpec,
  DesignSize,
  computeLayout,
  computeDesignFontSizes,
  DESIGN_TEXTBOX_WIDTH,
  DESIGN_TEXT_FONT,
  DesignPositionEntry,
} from '@gitroom/nestjs-libraries/studio/post-design-spec';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { parseDataUrl } from '@gitroom/nestjs-libraries/upload/data.url';
import pLimit from 'p-limit';
// Use undici's own fetch, NOT Node's global fetch. Global fetch cannot drive a
// dispatcher built from the undici *package* (the two undici builds have
// incompatible handler interfaces and it throws "invalid onRequestStart
// method"). With global fetch every background/logo load silently fails and the
// render falls back to a plain gradient. The upload storages already do this;
// keep it here too if an upstream sync reintroduces the global fetch.
import { fetch } from 'undici';

// This box is small (3.7 GiB, whole backend in one process). Don't let libvips
// retain decoded images between renders — a branded-draft render now composites
// a real photo background, and retained buffers add avoidable memory pressure.
sharp.cache(false);

// Fabric renders line height at 1.16 by default; mirror it so wrapped copy
// stacks the same server-side as it does in the browser design editor.
const LINE_HEIGHT = 1.16;

// Cap concurrent sharp renders. sharp/libvips is memory-heavy and this box is
// small (3.7 GiB + swap), so unbounded concurrent renders under peak traffic
// can OOM. One process today; move to a shared/Redis limiter if we scale out.
const renderLimit = pLimit(Number(process.env.DESIGN_RENDER_CONCURRENCY) || 2);

/**
 * Server-side renderer for a generated post design (`PostDesignSpec`).
 *
 * Fabric's node build (`fabric/node`) depends on node-canvas, whose native
 * binary is fragile across Node versions / base images. So instead of rendering
 * with Fabric on the server, we compose the flat PNG with the vector text
 * expressed as SVG and rasterised by `sharp` (already a dependency, prebuilt,
 * no native compile). The layout maths are shared with the browser renderer
 * (`post-design-spec.ts`) so the two can't drift.
 *
 * The PNG is a flat preview/attachment. The *editable* version is rebuilt in
 * Studio from the persisted `PostDesignSpec` via the existing browser renderer,
 * so the design stays fully editable without hand-authoring Fabric JSON.
 */
@Injectable()
export class DesignRenderService {
  async renderDesignToPng(
    spec: PostDesignSpec,
    size: DesignSize
  ): Promise<Buffer> {
    return renderLimit(() => this._renderDesignToPng(spec, size));
  }

  private async _renderDesignToPng(
    spec: PostDesignSpec,
    size: DesignSize
  ): Promise<Buffer> {
    const bgBuffer = spec.backgroundUrl
      ? await this.loadImage(spec.backgroundUrl)
      : null;

    // Composite over the real background when we have one, but never let a bad
    // background (corrupt bytes, unexpected dimensions, a sharp/libvips error)
    // fail the whole draft: fall back to the gradient, which is cheap and always
    // renders. Keeps the branded-draft loop from erroring on a single flaky
    // image instead of returning a usable post.
    if (bgBuffer) {
      try {
        return await this.compose(spec, size, bgBuffer);
      } catch (err) {
        console.error(
          '[design-render] background composite failed; rendering gradient instead',
          err
        );
      }
    }
    return this.compose(spec, size, null);
  }

  private async compose(
    spec: PostDesignSpec,
    size: DesignSize,
    bgBuffer: Buffer | null
  ): Promise<Buffer> {
    const { width, height } = size;

    // When we have a real background image the SVG overlay is text-only and
    // transparent; otherwise it carries the gradient placeholder itself.
    const overlay = Buffer.from(this.buildSvg(spec, size, !bgBuffer));

    const composites: OverlayOptions[] = [];
    let base: Sharp;
    if (bgBuffer) {
      // Cap decode size so a pathologically large image can't blow up memory;
      // our backgrounds are ~1–2 MP, so 30 MP is a generous safety limit.
      base = sharp(bgBuffer, { limitInputPixels: 30_000_000 }).resize(
        width,
        height,
        { fit: 'cover', position: 'centre' }
      );
      composites.push({ input: overlay, top: 0, left: 0 });
    } else {
      // Default density (72) rasterises the SVG at its declared pixel size.
      // A density of 96 scaled it by 96/72, so a 1080x1350 draft came out
      // 1440x1800 and the logo, positioned for 1080, landed in the wrong place.
      base = sharp(overlay);
    }

    const logo = await this.loadLogo(spec, size);
    if (logo) composites.push(logo);

    const rendered = composites.length ? base.composite(composites) : base;
    return rendered.png().toBuffer();
  }

  private buildSvg(
    spec: PostDesignSpec,
    size: DesignSize,
    includeGradient: boolean
  ): string {
    const { width, height } = size;
    const pos = computeLayout(spec.layout, width, height);
    const fonts = computeDesignFontSizes(width);

    const parts: string[] = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    );
    parts.push(
      `<defs>` +
        `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="${escapeXml(spec.colors.background)}"/>` +
        `<stop offset="100%" stop-color="#000000"/>` +
        `</linearGradient>` +
        `<filter id="ds" x="-20%" y="-20%" width="140%" height="140%">` +
        `<feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.5"/>` +
        `</filter>` +
        `</defs>`
    );

    if (includeGradient) {
      parts.push(
        `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)"/>`
      );
    }

    parts.push(
      this.text(spec.headline, pos.headline, {
        width: width * DESIGN_TEXTBOX_WIDTH.headline,
        fontSize: fonts.headline,
        fontWeight: 700,
        color: spec.colors.text,
        charWidth: 0.56,
        shadow: true,
      })
    );
    parts.push(
      this.text(spec.subtext, pos.subtext, {
        width: width * DESIGN_TEXTBOX_WIDTH.subtext,
        fontSize: fonts.subtext,
        fontWeight: 400,
        color: spec.colors.text,
        charWidth: 0.5,
        opacity: 0.9,
      })
    );
    parts.push(
      this.text(spec.cta, pos.cta, {
        width: width * DESIGN_TEXTBOX_WIDTH.cta,
        fontSize: fonts.cta,
        fontWeight: 600,
        color: spec.colors.accent,
        charWidth: 0.52,
      })
    );

    parts.push(`</svg>`);
    return parts.join('');
  }

  private text(
    raw: string,
    pos: DesignPositionEntry,
    opts: {
      width: number;
      fontSize: number;
      fontWeight: number;
      color: string;
      charWidth: number;
      opacity?: number;
      shadow?: boolean;
    }
  ): string {
    const value = (raw || '').trim();
    if (!value) return '';

    const lines = wrapText(value, opts.width, opts.fontSize, opts.charWidth);
    const anchor = pos.originX === 'center' ? 'middle' : 'start';
    const x = Math.round(pos.left);
    const firstBaseline = pos.top + opts.fontSize * 0.9;
    const step = opts.fontSize * LINE_HEIGHT;

    const tspans = lines
      .map((line, i) => {
        const y = Math.round(firstBaseline + i * step);
        return `<tspan x="${x}" y="${y}">${escapeXml(line)}</tspan>`;
      })
      .join('');

    const attrs = [
      `text-anchor="${anchor}"`,
      `font-family="${escapeXml(DESIGN_TEXT_FONT)}"`,
      `font-size="${opts.fontSize}"`,
      `font-weight="${opts.fontWeight}"`,
      `fill="${escapeXml(opts.color)}"`,
      opts.opacity != null ? `opacity="${opts.opacity}"` : '',
      opts.shadow ? `filter="url(#ds)"` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `<text ${attrs}>${tspans}</text>`;
  }

  private async loadLogo(
    spec: PostDesignSpec,
    size: DesignSize
  ): Promise<OverlayOptions | null> {
    const logoPath = spec.brandKit?.logoPath;
    if (!logoPath) return null;

    const buffer = await this.loadImage(logoPath);
    if (!buffer) return null;

    try {
      const targetWidth = Math.round(size.width * 0.12);
      const padding = Math.round(size.width * 0.04);
      // Brand-kit logos are user-uploaded — same decompression-bomb cap as
      // the background path above.
      const resized = await sharp(buffer, { limitInputPixels: 30_000_000 })
        .resize({ width: targetWidth })
        .png()
        .toBuffer();
      const meta = await sharp(resized, {
        limitInputPixels: 30_000_000,
      }).metadata();
      const logoHeight = meta.height ?? targetWidth;
      return {
        input: resized,
        top: Math.max(0, size.height - padding - logoHeight),
        left: Math.max(0, size.width - padding - targetWidth),
      };
    } catch {
      // A broken logo must never fail the whole render.
      return null;
    }
  }

  /** Fetch an image (data URL or SSRF-checked https) into a Buffer, or null. */
  private async loadImage(url: string): Promise<Buffer | null> {
    try {
      if (url.startsWith('data:')) {
        return parseDataUrl(url).buffer;
      }
      if (!(await isSafePublicHttpsUrl(url))) return null;
      const res = await fetch(url, {
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
        // Don't let a slow S3/CDN pin the render; on timeout the catch below
        // returns null and the design falls back to its gradient background.
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Greedy word-wrap using an average-character-width estimate. Text in a design
 * is short (headline ≤60, subtext ≤120, cta ≤30) so an estimate wraps cleanly
 * without needing a real font metrics engine.
 */
function wrapText(
  text: string,
  maxWidthPx: number,
  fontSize: number,
  charWidth: number
): string[] {
  const avgChar = fontSize * charWidth;
  const maxChars = Math.max(1, Math.floor(maxWidthPx / avgChar));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
