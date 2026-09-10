'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  BrandTextStyle,
  drawBrandText,
  ensureFontLoaded,
  safeAreaMargin,
} from '@gitroom/frontend/components/video-studio/text-overlay';

interface BrandTextPreviewProps {
  /** A clip, or the first photo of a slideshow. */
  source: Blob | null;
  /** Frame size to compose for — the slideshow picks a format, video uses its own. */
  format?: { width: number; height: number };
  style: BrandTextStyle;
  /** Draw the platform's interface zone, so text is not placed under it. */
  showSafeArea?: boolean;
}

const MAX_PREVIEW_HEIGHT = 260;

/**
 * What the render will look like, before spending the render.
 *
 * Text on video and Photos-to-video both asked people to choose a position, a
 * colour, a size and a font, and then showed them the result only after a
 * minute of encoding. This paints a single frame with the same `drawBrandText`
 * the pipelines use, so the preview cannot drift from the output.
 */
export const BrandTextPreview: FC<BrandTextPreviewProps> = ({
  source,
  format,
  style,
  showSafeArea,
}) => {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<ImageBitmap | HTMLVideoElement | null>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  // Decode one frame per source, not per keystroke.
  useEffect(() => {
    let cancelled = false;
    let video: HTMLVideoElement | null = null;
    let url: string | null = null;
    frameRef.current = null;
    setFrameSize(null);
    setFailed(false);
    if (!source) return;

    const load = async () => {
      if (source.type.startsWith('image/')) {
        try {
          const bitmap = await createImageBitmap(source);
          if (cancelled) {
            bitmap.close();
            return;
          }
          frameRef.current = bitmap;
          setFrameSize({ w: bitmap.width, h: bitmap.height });
        } catch {
          if (!cancelled) setFailed(true);
        }
        return;
      }

      url = URL.createObjectURL(source);
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = url;
      video.onerror = () => {
        if (!cancelled) setFailed(true);
      };
      video.onloadeddata = () => {
        if (cancelled) return;
        frameRef.current = video;
        setFrameSize({ w: video!.videoWidth, h: video!.videoHeight });
      };
      // A frame a little way in is more representative than a black first one.
      video.onloadedmetadata = () => {
        if (!cancelled && video) video.currentTime = Math.min(0.5, video.duration / 4);
      };
    };

    load();
    return () => {
      cancelled = true;
      const held = frameRef.current;
      if (held && 'close' in held) held.close();
      frameRef.current = null;
      if (video) video.src = '';
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);

  // Repaint whenever the text or the styling changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frameSize) return;
    const width = format?.width ?? frameSize.w;
    const height = format?.height ?? frameSize.h;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      ctx.fillStyle = style.bandColor;
      ctx.fillRect(0, 0, width, height);
      if (frame) {
        // Cover the frame the same way the pipelines do, so what is cropped
        // out here is cropped out there.
        const scale = Math.max(width / frameSize.w, height / frameSize.h);
        const drawW = frameSize.w * scale;
        const drawH = frameSize.h * scale;
        try {
          ctx.drawImage(
            frame as CanvasImageSource,
            (width - drawW) / 2,
            (height - drawH) / 2,
            drawW,
            drawH
          );
        } catch {
          /* a frame that is not ready yet paints on the next change */
        }
      }
      if (showSafeArea) {
        const margin = safeAreaMargin(width, height);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, height - margin.bottom, width, margin.bottom);
        ctx.fillRect(0, 0, width, margin.top);
        ctx.strokeStyle = 'rgba(248,81,73,0.85)';
        ctx.lineWidth = Math.max(2, Math.round(width * 0.003));
        ctx.setLineDash([Math.round(width * 0.02), Math.round(width * 0.015)]);
        ctx.beginPath();
        ctx.moveTo(0, height - margin.bottom);
        ctx.lineTo(width, height - margin.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawBrandText(ctx, width, height, style);
    };

    ensureFontLoaded(style.fontFamily, Math.round(width * 0.055)).then(paint, paint);
    return () => {
      cancelled = true;
    };
  }, [frameSize, format, style, showSafeArea]);

  if (!source) return null;
  if (failed) {
    return (
      <div className="text-[11px] text-textColor/60">
        {t('video_preview_unavailable', 'No preview for this file — the render still works.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <canvas
        ref={canvasRef}
        style={{ maxHeight: MAX_PREVIEW_HEIGHT }}
        className="w-auto max-w-full mx-auto rounded border border-newBorder bg-black"
      />
      {showSafeArea && (
        <div className="text-[10px] text-textColor/50 text-center">
          {t(
            'video_safe_area_hint',
            'The shaded strips are where TikTok and Reels put their own buttons.'
          )}
        </div>
      )}
    </div>
  );
};
