'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import {
  StudioIcon,
  StudioIconName,
} from '@gitroom/frontend/components/studio/studio-icons';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/frontend/components/ui/button';
import { STUDIO_FONTS } from '../design-editor/fonts';
import { VideoLibraryPicker, LibraryMedia } from './video-library-picker';
import {
  fetchLibraryVideoAsFile,
  VideoTooLargeError,
  assertVideoSize,
} from './load-library-media';
import * as Sentry from '@sentry/nextjs';
import { composeVideo, ClipTooLongError, UnsupportedCodecError } from './compositor-pipeline';
import { useRenderJob } from './use-render-job';
import { ResultPanel } from './result-panel';
import { BrandTextPreview } from './brand-text-preview';
import {
  TextPosition,
  fontFamilyForLabel,
  ensureFontLoaded,
  hexToRgba,
  drawBrandText,
} from './text-overlay';
import { useBrandKit } from './use-brand-kit';

interface VideoTextOverlayProps {
  /** Hand the rendered clip (already uploaded) back to the post. */
  onReady: (media: { id: string; path: string }) => void;
}

const POSITIONS: { key: TextPosition; label: string; icon: StudioIconName }[] = [
  { key: 'top', label: 'Top', icon: 'moveUp' },
  { key: 'middle', label: 'Middle', icon: 'select' },
  { key: 'bottom', label: 'Bottom', icon: 'moveDown' },
];

const SIZES: { key: string; label: string; scale: number }[] = [
  { key: 's', label: 'S', scale: 0.8 },
  { key: 'm', label: 'M', scale: 1 },
  { key: 'l', label: 'L', scale: 1.25 },
];

/**
 * "Tekst" — burn manual, on-brand text into a clip. Colour and font default to
 * the active org's Brand Kit (so an agency's client gets THEIR colours, never a
 * hardcoded Postra blue); the user can still override per clip. Decode → paint
 * the branded band → re-encode runs through the shared compositor pipeline,
 * with the original audio carried through untouched.
 */
export const VideoTextOverlay: FC<VideoTextOverlayProps> = ({ onReady }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const mediaDirectory = useMediaDirectory();
  const { kit, loading: kitLoading } = useBrandKit();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(() => t('video_text_default_headline', 'New in store'));
  const [position, setPosition] = useState<TextPosition>('bottom');
  const [color, setColor] = useState<string | null>(null);
  const [fontLabel, setFontLabel] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  const job = useRenderJob();
  const busy = job.busy;
  const progress = job.progress;
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [hadAudio, setHadAudio] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [importing, setImporting] = useState(false);

  // Seed colour/font from the Brand Kit once it loads; user edits win after.
  const seeded = useRef(false);
  useEffect(() => {
    if (kitLoading || seeded.current) return;
    seeded.current = true;
    setColor((c) => c ?? kit.primaryColor);
    setFontLabel((f) => f ?? kit.font);
  }, [kitLoading, kit]);

  const effectiveColor = color ?? kit.primaryColor;
  const effectiveFontLabel = fontLabel ?? kit.font;

  // The result panel owns the preview URL and revokes it, so nothing here has
  // to remember to.
  const resetResult = useCallback(() => setResultBlob(null), []);

  const compose = useCallback(async () => {
    if (!file || busy) return;
    resetResult();

    const fontFamily = fontFamilyForLabel(effectiveFontLabel);
    const bandColor = hexToRgba(kit.secondaryColor, 0.55);
    try {
      // Load the chosen webfont before painting, or the canvas falls back to a
      // default face. Probe size is indicative; the loop sizes per frame width.
      await ensureFontLoaded(fontFamily, 64);
      const result = await job.run((signal) =>
        composeVideo({
          file,
          signal,
          onProgress: (r) => job.setProgress(Math.round(r * 100)),
          drawOverlay: (ctx, { width, height }) =>
            drawBrandText(ctx, width, height, {
              text,
              position,
              color: effectiveColor,
              bandColor,
              fontFamily,
              scale,
            }),
        })
      );
      if (!result) return;
      setResultBlob(result.blob);
      setHadAudio(result.hadAudio);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Postra:text-overlay] failed:', err);
      Sentry.captureException(err);
      toaster.show(
        err instanceof ClipTooLongError
          ? t('clip_too_long', 'Clip is too long to edit in the browser (5 min limit). Use a shorter one.')
          : err instanceof UnsupportedCodecError
          ? t(
              'clip_codec_unsupported',
              "This clip's video format can't be decoded by your browser (often HEVC/H.265 from a phone). Re-export it as a standard MP4 (H.264) and try again."
            )
          : t('clip_text_failed', 'Failed to burn the text into the video. Try a different clip — our team has been notified.'),
        'warning'
      );
    }
  }, [
    file,
    busy,
    resetResult,
    effectiveFontLabel,
    effectiveColor,
    kit.secondaryColor,
    text,
    position,
    scale,
    toaster,
    t,
    job,
  ]);



  const loadFromLibrary = useCallback(
    async (media: LibraryMedia) => {
      setImporting(true);
      try {
        const loaded = await fetchLibraryVideoAsFile(mediaDirectory.set(media.path));
        setFile(loaded);
        resetResult();
        setShowLibrary(false);
      } catch (e) {
        toaster.show(
          e instanceof VideoTooLargeError
            ? t(
                'video_library_too_big',
                'This clip is too large to edit in the browser (200 MB limit). Use a shorter one.'
              )
            : t('video_library_load_failed', 'Failed to load the video from the library.'),
          'warning'
        );
      } finally {
        setImporting(false);
      }
    },
    [mediaDirectory, toaster, t, resetResult]
  );

  return (
    <div className="flex flex-col gap-3 p-3 text-textColor">
      <div className="text-[11px] text-textColor/70 leading-snug">
        <StudioIcon name="textOnVideo" size={14} className="inline-block shrink-0" />{' '}
        {t(
          'clip_text_intro',
          'Upload a clip (or grab B-roll from the library), type your text — we burn it into the video in your Brand Kit colour and font. Audio stays.'
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            try {
              assertVideoSize(f);
              setFile(f);
              resetResult();
            } catch {
              toaster.show(
                t('video_disk_too_big', 'File is too large to edit in the browser (200 MB limit).'),
                'warning'
              );
            }
          }
          e.target.value = '';
        }}
      />
      <div className="flex gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || importing}
          className="flex-1 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors disabled:opacity-50"
        >
          {t('video_source_disk', 'From disk')}
        </button>
        <button
          onClick={() => setShowLibrary(true)}
          disabled={busy || importing}
          className="flex-1 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors disabled:opacity-50"
        >
          {t('video_source_library', 'From library')}
        </button>
      </div>
      {file && (
        <div className="text-[11px] text-textColor/60 truncate"><StudioIcon name="done" size={12} className="inline-block" /> {file.name}</div>
      )}

      {file && !resultBlob && (
        <BrandTextPreview
          source={file}
          showSafeArea={true}
          style={{
            text,
            position,
            color: effectiveColor,
            bandColor: hexToRgba(kit.secondaryColor, 0.55),
            fontFamily: fontFamilyForLabel(effectiveFontLabel),
            scale,
          }}
        />
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        rows={2}
        placeholder={t('clip_text_placeholder', 'Text on video')}
        className="text-xs px-2 py-2 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/40 focus:outline-none focus:border-forth disabled:opacity-50 resize-none"
      />

      {/* Position */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-textColor/60">{t('clip_text_position', 'Position')}</label>
        <div className="flex gap-2">
          {POSITIONS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPosition(p.key)}
              disabled={busy}
              className={`flex-1 text-xs px-2 py-1.5 rounded transition-colors disabled:opacity-50 ${
                position === p.key
                  ? 'bg-newAccent text-[#06222e] font-[600]'
                  : 'bg-newColColor text-textColor hover:bg-white/[0.08]'
              }`}
            >
              <StudioIcon name={p.icon} size={14} className="inline-block me-1" />
              {t(`clip_text_pos_${p.key}`, p.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Colour + size, defaulting to the Brand Kit */}
      <div className="flex gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-textColor/60">{t('clip_text_color', 'Colour')}</label>
          <div className="flex items-center gap-2">
            <div className="relative w-8 h-8 shrink-0">
              <div
                className="absolute inset-0 rounded-md border border-newBorder shadow-inner pointer-events-none"
                style={{ backgroundColor: effectiveColor }}
              />
              <input
                type="color"
                value={effectiveColor}
                onChange={(e) => setColor(e.target.value)}
                disabled={busy}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                aria-label={t('clip_text_color', 'Colour')}
              />
            </div>
            {color && color.toLowerCase() !== kit.primaryColor.toLowerCase() && (
              <button
                onClick={() => setColor(kit.primaryColor)}
                disabled={busy}
                className="text-[11px] text-newAccent underline disabled:opacity-50"
              >
                {t('clip_text_brand_color', 'Brand')}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[11px] text-textColor/60">{t('clip_text_size', 'Size')}</label>
          <div className="flex gap-2">
            {SIZES.map((s) => (
              <button
                key={s.key}
                onClick={() => setScale(s.scale)}
                disabled={busy}
                className={`flex-1 text-xs px-2 py-1.5 rounded transition-colors disabled:opacity-50 ${
                  scale === s.scale
                    ? 'bg-newAccent text-[#06222e] font-[600]'
                    : 'bg-newColColor text-textColor hover:bg-white/[0.08]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Font */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-textColor/60">{t('font', 'Font')}</label>
        <select
          value={effectiveFontLabel}
          onChange={(e) => setFontLabel(e.target.value)}
          disabled={busy}
          className="text-xs px-2 py-1.5 rounded bg-newColColor border border-newBorder text-textColor focus:outline-none focus:border-forth disabled:opacity-50"
        >
          {STUDIO_FONTS.map((font) => (
            <option key={font.key} value={font.label} style={{ fontFamily: font.family }}>
              {font.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={compose}
          disabled={!file || busy}
          className="self-start"
        >
          {busy
            ? `${t('clip_text_running', 'Rendering…')} ${progress}%`
            : t('clip_text_run', 'Burn text into video')}
        </Button>
        {busy && (
          <Button
            onClick={job.cancel}
            disabled={job.cancelling}
            secondary={true}
            className="self-start"
          >
            {job.cancelling
              ? t('video_cancelling', 'Cancelling…')
              : t('video_cancel_render', 'Cancel')}
          </Button>
        )}
      </div>

      {resultBlob && (
        <ResultPanel
          results={[
            {
              key: 'clip',
              label: t('video_result_clip', 'Clip'),
              blob: resultBlob,
              hadAudio,
            },
          ]}
          fileNameFor={() => `postra-clip-${Date.now()}`}
          onUseInPost={onReady}
        />
      )}

      {/* Fills VideoStudio's relative content area, like the trim/library flow. */}
      {showLibrary && (
        <div className="absolute inset-0 z-[20]">
          <VideoLibraryPicker
            onPick={loadFromLibrary}
            onClose={() => setShowLibrary(false)}
            busy={importing}
          />
        </div>
      )}
    </div>
  );
};
