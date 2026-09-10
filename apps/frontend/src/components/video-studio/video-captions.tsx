'use client';

import { FC, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/frontend/components/ui/button';
import * as Sentry from '@sentry/nextjs';
import { composeVideo, ClipTooLongError, UnsupportedCodecError } from './compositor-pipeline';
import { useRenderJob } from './use-render-job';
import { parseSrt, captionAt } from './srt';
import {
  fontFamilyForLabel,
  ensureFontLoaded,
  hexToRgba,
  drawBrandText,
} from './text-overlay';
import { useBrandKit } from './use-brand-kit';

interface VideoCaptionsProps {
  mediaId: string | null;
  /** The local clip bytes — when present we render captions in-browser, branded. */
  source: Blob | null;
  onCaptioned: (newMedia: { id: string; path: string }) => void;
}

export const VideoCaptions: FC<VideoCaptionsProps> = ({ mediaId, source, onCaptioned }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { kit } = useBrandKit();
  const [srt, setSrt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const job = useRenderJob();
  const isBurning = job.busy;
  const burnProgress = job.progress;
  const { i18n } = useTranslation();
  // Default transcription language follows the UI locale (UK-first product —
  // 'pl' is only right for the Polish UI), and 'auto' stays one click away.
  const [language, setLanguage] = useState(() =>
    (i18n.resolvedLanguage ?? i18n.language ?? 'en').toLowerCase().startsWith('pl')
      ? 'pl'
      : 'en'
  );

  const handleGenerate = useCallback(async () => {
    if (!mediaId) {
      toaster.show(
        t(
          'video_captions_no_media',
          'Load a video first (Trim / From library) to transcribe it.'
        ),
        'warning'
      );
      return;
    }
    setIsGenerating(true);
    try {
      const res = await fetch(`/media/${mediaId}/auto-caption`, {
        method: 'POST',
        // Auto-detect means "don't send a language", not "send an empty one".
        body: JSON.stringify(language ? { language } : {}),
      });
      if (!res.ok) {
        // One catch-all message hid the three things that actually go wrong
        // here: a brand-new account inside the AI cooldown, the per-org rate
        // limit, and a clip too long for Whisper.
        toaster.show(
          res.status === 403
            ? t(
                'video_captions_too_new',
                'AI features unlock about an hour after signup. Try again shortly.'
              )
            : res.status === 429
            ? t(
                'video_captions_rate_limited',
                'Too many caption requests. Wait a few minutes and try again.'
              )
            : res.status === 413
            ? t(
                'video_captions_too_long',
                "That clip's audio is too long to transcribe. Trim it and try again."
              )
            : t('video_captions_failed', 'Caption generation failed.'),
          'warning'
        );
        return;
      }
      const data = await res.json();
      setSrt(data?.srt ?? '');
    } catch {
      // A 402/406 is handled globally and rejects with a marker; anything else
      // reaching here would otherwise surface as an unhandled rejection.
      toaster.show(t('video_captions_failed', 'Caption generation failed.'), 'warning');
    } finally {
      setIsGenerating(false);
    }
  }, [mediaId, language, fetch, toaster, t]);

  const uploadResult = useCallback(
    async (blob: Blob) => {
      const formData = new FormData();
      formData.append('file', blob, `captioned-${Date.now()}.mp4`);
      const res = await fetch('/media/upload-simple', { method: 'POST', body: formData });
      const data = await res.json();
      if (data?.id && data?.path) onCaptioned({ id: data.id, path: data.path });
      else throw new Error('upload returned no media');
    },
    [fetch, onCaptioned]
  );

  const handleBurn = useCallback(async () => {
    if (!srt.trim() || isBurning) return;
    const segments = parseSrt(srt);
    if (!segments.length) {
      toaster.show(
        t('video_captions_no_segments', 'Could not parse any caption segments (check the SRT format).'),
        'warning'
      );
      return;
    }
    try {
      if (source) {
        // Branded, in-browser render on the shared compositor — captions are a
        // timed overlay, same look as the rest of Postra Clip, no server ffmpeg.
        const fontFamily = fontFamilyForLabel(kit.font);
        const bandColor = hexToRgba(kit.secondaryColor, 0.6);
        await ensureFontLoaded(fontFamily, 48);
        const result = await job.run((signal) =>
          composeVideo({
            file: source,
            signal,
            onProgress: (r) => job.setProgress(Math.round(r * 100)),
            drawOverlay: (ctx, { timestampSec, width, height }) => {
              const cap = captionAt(segments, timestampSec);
              if (cap) {
                drawBrandText(ctx, width, height, {
                  text: cap,
                  position: 'bottom',
                  color: kit.textColor,
                  bandColor,
                  fontFamily,
                  scale: 0.78,
                });
              }
            },
          })
        );
        if (!result) return;
        await uploadResult(result.blob);
      } else if (mediaId) {
        // Fallback: server burn-in when we don't hold the local bytes. Cancel
        // here only drops our end of the request — ffmpeg on the server runs to
        // completion — so the file still lands in the library.
        const data = await job.run(async (signal) => {
          const res = await fetch(`/media/${mediaId}/burn-captions`, {
            method: 'POST',
            body: JSON.stringify({ srt }),
            signal,
          });
          if (!res.ok) {
            toaster.show(t('video_burn_failed', 'Burning captions failed.'), 'warning');
            return null;
          }
          return res.json();
        });
        if (data?.id && data?.path) onCaptioned({ id: data.id, path: data.path });
      } else {
        toaster.show(
          t('video_captions_no_media', 'Load a video first (Trim / From library) to transcribe it.'),
          'warning'
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Postra:captions] burn failed:', err);
      Sentry.captureException(err);
      toaster.show(
        err instanceof ClipTooLongError
          ? t('clip_too_long', 'Clip is too long to edit in the browser (5 min limit). Use a shorter one.')
          : err instanceof UnsupportedCodecError
          ? t(
              'clip_codec_unsupported',
              "This clip's video format can't be decoded by your browser (often HEVC/H.265 from a phone). Re-export it as a standard MP4 (H.264) and try again."
            )
          : t('video_burn_failed', 'Burning captions failed. Try a different clip — our team has been notified.'),
        'warning'
      );
    }
  }, [srt, isBurning, source, mediaId, kit, fetch, uploadResult, onCaptioned, toaster, t, job]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs text-textColor/80">
        {t(
          'video_captions_explainer',
          'Whisper AI transcribes the speech in your video into captions. Edit them, then we burn them into the clip in your brand.'
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-wide text-textColor/60">
          {t('video_captions_language', 'Language')}
        </label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={isGenerating || isBurning}
          className="text-xs px-2 py-1 rounded bg-newColColor border border-newBorder text-textColor"
        >
          <option value="pl">Polski</option>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="">{t('video_captions_auto', 'Auto-detect')}</option>
        </select>
        <Button
          loading={isGenerating}
          onClick={handleGenerate}
          disabled={!mediaId}
          className="!h-[28px] !text-xs"
        >
          {t('video_captions_generate', 'Generate captions')}
        </Button>
      </div>
      <textarea
        value={srt}
        onChange={(e) => setSrt(e.target.value)}
        placeholder={t(
          'video_captions_placeholder',
          'Generated captions will appear here in SRT format. Edit them before burning in.'
        )}
        rows={12}
        disabled={isGenerating || isBurning}
        className="text-[11px] font-mono p-2 rounded bg-newColColor border border-newBorder text-textColor resize-none focus:outline-none focus:border-forth disabled:opacity-50 leading-relaxed"
      />
      <div className="flex justify-between items-center">
        <div className="text-[11px] text-textColor/65">
          {srt.trim().length > 0
            ? t('video_captions_lines', '{n} SRT characters').replace('{n}', String(srt.length))
            : t('video_captions_empty', 'No captions')}
        </div>
        <div className="flex items-center gap-2">
          {isBurning && (
            <Button
              onClick={job.cancel}
              disabled={job.cancelling}
              secondary={true}
              className="!h-[28px] !text-xs"
            >
              {job.cancelling
                ? t('video_cancelling', 'Cancelling…')
                : t('video_cancel_render', 'Cancel')}
            </Button>
          )}
          <Button
            loading={isBurning}
            onClick={handleBurn}
            disabled={!srt.trim() || (!source && !mediaId)}
            className="!h-[28px] !text-xs"
          >
            {isBurning && source
              ? `${t('video_captions_burning', 'Burning…')} ${burnProgress}%`
              : t('video_captions_burn', 'Burn into video')}
          </Button>
        </div>
      </div>
      <div className="text-[11px] text-textColor/65 leading-snug">
        {source
          ? t(
              'video_captions_hint_browser',
              'Captions are burned in right in your browser, styled with your Brand Kit colour and font — the original audio stays untouched.'
            )
          : t(
              'video_captions_hint',
              'Burning in returns a new MP4 with the captions styled to your Brand Kit — the original audio stays untouched.'
            )}
      </div>
    </div>
  );
};
