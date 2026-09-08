'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/frontend/components/ui/button';
import { VIDEO_FORMATS, VideoFormat } from './video-formats';
import { composeSlideshow, UndecodableImageError } from './slideshow-pipeline';
import {
  fontFamilyForLabel,
  ensureFontLoaded,
  hexToRgba,
  drawBrandText,
} from './text-overlay';
import { useBrandKit } from './use-brand-kit';

interface VideoSlideshowProps {
  onReady: (media: { id: string; path: string }) => void;
}

interface Picked {
  id: string;
  file: File;
  url: string;
}

const MAX_IMAGES = 10;
// Extensions worth trying even when the browser hands us a useless MIME
// type. HEIC is the one that matters - it is the iPhone default.
const IMAGE_EXTENSION = /\.(heic|heif|jpe?g|png|webp|gif|bmp|avif|tiff?)$/i;
const PRESETS: { key: string; label: string }[] = [
  { key: 'video_slideshow_preset_new', label: 'New arrival' },
  { key: 'video_slideshow_preset_sale', label: 'Sale' },
  { key: 'video_slideshow_preset_promo', label: 'Promotion' },
  { key: 'video_slideshow_preset_available', label: 'Available now' },
];

let pickedSeq = 0;

/**
 * "Zdjęcia → wideo" — turn product photos into a branded vertical clip. Same
 * compositor output as the rest of Postra Clip; the headline reads the active
 * Brand Kit. Built for the shop owner who has photos, not footage.
 */
export const VideoSlideshow: FC<VideoSlideshowProps> = ({ onReady }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { kit, loading: kitLoading } = useBrandKit();
  const fileRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<Picked[]>([]);
  const [format, setFormat] = useState<VideoFormat>(VIDEO_FORMATS[0]);
  const [secondsPer, setSecondsPer] = useState(2.5);
  const [text, setText] = useState(() => t('video_text_default_headline', 'New in store'));
  const [color, setColor] = useState<string | null>(null);
  const [fontLabel, setFontLabel] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const seeded = useRef(false);
  useEffect(() => {
    if (kitLoading || seeded.current) return;
    seeded.current = true;
    setColor((c) => c ?? kit.primaryColor);
    setFontLabel((f) => f ?? kit.font);
  }, [kitLoading, kit]);

  // Revoke every object URL we created on unmount. The cleanup has to read
  // through refs: with an empty dependency list it closes over the FIRST
  // render's empty arrays, so the version that read `images` directly revoked
  // nothing and leaked every photo for the life of the tab.
  const liveUrlsRef = useRef<{ images: string[]; result: string | null }>({
    images: [],
    result: null,
  });
  liveUrlsRef.current = {
    images: images.map((p) => p.url),
    result: resultUrl,
  };
  useEffect(
    () => () => {
      liveUrlsRef.current.images.forEach((url) => URL.revokeObjectURL(url));
      if (liveUrlsRef.current.result) URL.revokeObjectURL(liveUrlsRef.current.result);
    },
    []
  );

  const effectiveColor = color ?? kit.primaryColor;
  const effectiveFontLabel = fontLabel ?? kit.font;

  const resetResult = useCallback(() => {
    setResultBlob(null);
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const addFiles = useCallback(
    async (files: FileList) => {
      // A .heic straight off an iPhone frequently arrives as
      // application/octet-stream, and filtering on MIME alone dropped it here -
      // before the probe below could name it - so the picker simply did
      // nothing and the "Add photos (n/10)" counter never moved. Take anything
      // that reads as an image by type OR by extension and let
      // createImageBitmap be the judge; the unreadable ones still get named.
      const picked = Array.from(files).filter(
        (f) => f.type.startsWith('image/') || IMAGE_EXTENSION.test(f.name)
      );
      if (!picked.length) {
        toaster.show(
          t(
            'slideshow_not_photos',
            'Those files are not photos. Pick JPEG or PNG images.'
          ),
          'warning'
        );
        return;
      }

      // Probe each photo now rather than failing minutes later, mid-render.
      // HEIC is why: it's the iPhone default, Safari reads it and Chrome does
      // not, so the answer depends on the browser and has to name the file.
      const probes = await Promise.all(
        picked.map(async (f) => {
          try {
            (await createImageBitmap(f)).close();
            return { file: f, ok: true };
          } catch {
            return { file: f, ok: false };
          }
        })
      );
      const unreadable = probes.filter((p) => !p.ok).map((p) => p.file.name);
      const incoming = probes.filter((p) => p.ok).map((p) => p.file);
      if (unreadable.length) {
        toaster.show(
          t(
            'slideshow_unreadable',
            "Your browser can't read {files} (iPhone HEIC photos usually). Export them as JPEG and add them again."
          ).replace('{files}', unreadable.join(', ')),
          'warning'
        );
      }
      if (!incoming.length) return;

      setImages((prev) => {
        const room = MAX_IMAGES - prev.length;
        if (room <= 0) {
          toaster.show(
            t('slideshow_max', 'Maximum {n} photos per clip.').replace('{n}', String(MAX_IMAGES)),
            'warning'
          );
          return prev;
        }
        const next = incoming.slice(0, room).map((file) => ({
          id: `img-${pickedSeq++}`,
          file,
          url: URL.createObjectURL(file),
        }));
        return [...prev, ...next];
      });
      resetResult();
    },
    [toaster, t, resetResult]
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
    resetResult();
  }, [resetResult]);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setImages((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
    resetResult();
  }, [resetResult]);

  const compose = useCallback(async () => {
    if (!images.length || busy) return;
    setBusy(true);
    setProgress(0);
    resetResult();

    const fontFamily = fontFamilyForLabel(effectiveFontLabel);
    const bandColor = hexToRgba(kit.secondaryColor, 0.55);
    const headline = text.trim();
    try {
      await ensureFontLoaded(fontFamily, 64);
      const result = await composeSlideshow({
        images: images.map((p) => p.file),
        width: format.width,
        height: format.height,
        secondsPerImage: secondsPer,
        backgroundColor: kit.secondaryColor,
        onProgress: (r) => setProgress(Math.round(r * 100)),
        drawOverlay: headline
          ? (ctx, { width, height }) =>
              drawBrandText(ctx, width, height, {
                text: headline,
                position: 'bottom',
                color: effectiveColor,
                bandColor,
                fontFamily,
              })
          : undefined,
      });
      setResultBlob(result.blob);
      setResultUrl(URL.createObjectURL(result.blob));
    } catch (err) {
      toaster.show(
        err instanceof UndecodableImageError
          ? t(
              'slideshow_unreadable',
              "Your browser can't read {files} (iPhone HEIC photos usually). Export them as JPEG and add them again."
            ).replace('{files}', err.fileName)
          : t(
              'slideshow_failed',
              'Failed to build the video from these photos. Try removing the last one you added.'
            ),
        'warning'
      );
    } finally {
      setBusy(false);
    }
  }, [
    images,
    busy,
    resetResult,
    effectiveFontLabel,
    effectiveColor,
    kit.secondaryColor,
    text,
    format,
    secondsPer,
    toaster,
    t,
  ]);

  const uploadResult = useCallback(async (): Promise<{ id: string; path: string } | null> => {
    if (!resultBlob || uploading) return null;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', resultBlob, `postra-slideshow-${Date.now()}.mp4`);
      const res = await fetch('/media/upload-simple', { method: 'POST', body: formData });
      const data = await res.json();
      if (data?.id && data?.path) return { id: data.id, path: data.path };
      throw new Error('upload returned no media');
    } catch {
      toaster.show(t('clip_text_upload_failed', 'Clip upload failed.'), 'warning');
      return null;
    } finally {
      setUploading(false);
    }
  }, [resultBlob, uploading, fetch, toaster, t]);

  const useInPost = useCallback(async () => {
    const media = await uploadResult();
    if (media) onReady(media);
  }, [uploadResult, onReady]);

  // "Just save" without leaving the tool — the honest sibling of Use in post.
  const saveToLibrary = useCallback(async () => {
    const media = await uploadResult();
    if (media) {
      toaster.show(
        t('video_saved_to_library', 'Saved to media library — you can use it in any post.'),
        'success'
      );
    }
  }, [uploadResult, toaster, t]);

  return (
    <div className="flex flex-col gap-3 p-3 text-textColor">
      <div className="text-[11px] text-textColor/70 leading-snug">
        🖼{' '}
        {t(
          'slideshow_intro',
          'Got product photos but no footage? Drop in a few — we turn them into a vertical clip with subtle motion and text in your brand.'
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        // image/* alone can hide .heic in the OS picker on some platforms,
        // and the file arrives with a generic MIME type anyway.
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy || images.length >= MAX_IMAGES}
        className="text-xs px-3 py-2 rounded bg-newColColor hover:bg-forth text-textColor transition-colors disabled:opacity-50"
      >
        📁 {t('slideshow_add', 'Add photos')} ({images.length}/{MAX_IMAGES})
      </button>

      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((p, i) => (
            <div key={p.id} className="relative shrink-0 w-16">
              <img
                src={p.url}
                alt=""
                className="w-16 h-16 object-cover rounded border border-newBorder"
              />
              <button
                onClick={() => removeImage(p.id)}
                disabled={busy}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[11px] leading-none disabled:opacity-50"
                aria-label={t('remove', 'Remove')}
              >
                ×
              </button>
              <div className="flex justify-between mt-0.5">
                <button
                  onClick={() => move(p.id, -1)}
                  disabled={busy || i === 0}
                  className="text-[11px] text-textColor/60 disabled:opacity-30"
                >
                  ◀
                </button>
                <button
                  onClick={() => move(p.id, 1)}
                  disabled={busy || i === images.length - 1}
                  className="text-[11px] text-textColor/60 disabled:opacity-30"
                >
                  ▶
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Format + seconds per image */}
      <div className="flex gap-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[10px] text-textColor/60">{t('slideshow_format', 'Format')}</label>
          <select
            value={format.key}
            onChange={(e) =>
              setFormat(VIDEO_FORMATS.find((f) => f.key === e.target.value) ?? VIDEO_FORMATS[0])
            }
            disabled={busy}
            className="text-xs px-2 py-1.5 rounded bg-newColColor border border-newBorder text-textColor focus:outline-none focus:border-forth disabled:opacity-50"
          >
            {VIDEO_FORMATS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 w-28">
          <label className="text-[10px] text-textColor/60">
            {t('slideshow_seconds', 'Seconds/photo')}
          </label>
          <select
            value={secondsPer}
            onChange={(e) => setSecondsPer(Number(e.target.value))}
            disabled={busy}
            className="text-xs px-2 py-1.5 rounded bg-newColColor border border-newBorder text-textColor focus:outline-none focus:border-forth disabled:opacity-50"
          >
            {[1.5, 2, 2.5, 3, 4].map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Headline */}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        placeholder={t('slideshow_text', 'Text (leave empty = no text)')}
        className="text-xs px-2 py-2 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/40 focus:outline-none focus:border-forth disabled:opacity-50"
      />
      <div className="flex gap-1.5 flex-wrap">
        {PRESETS.map((p) => {
          const label = t(p.key, p.label);
          return (
            <button
              key={p.key}
              onClick={() => setText(label)}
              disabled={busy}
              className="text-[10px] px-2 py-1 rounded bg-newColColor hover:bg-forth text-textColor/80 transition-colors disabled:opacity-50"
            >
              {label}
            </button>
          );
        })}
      </div>

      <button
        onClick={compose}
        disabled={!images.length || busy}
        className="px-3 py-2 text-sm rounded bg-newAccent text-white hover:bg-forth disabled:opacity-50 transition-colors"
      >
        {busy
          ? `${t('slideshow_running', 'Building video…')} ${progress}%`
          : t('slideshow_run', '🎬 Build video from photos')}
      </button>

      {resultUrl && (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] text-green-400">
            ✓ {t('compositor_no_audio', 'no audio')}
          </div>
          <video src={resultUrl} controls className="w-full rounded border border-newBorder" />
          <div className="flex items-center gap-2">
            <Button loading={uploading} onClick={useInPost} className="!h-[30px] !text-xs">
              {t('clip_text_use_in_post', 'Use in post')}
            </Button>
            <button
              onClick={saveToLibrary}
              disabled={uploading}
              className="text-xs px-3 h-[30px] rounded bg-newColColor text-textColor hover:bg-forth transition-colors disabled:opacity-50"
            >
              💾 {t('save_to_library_btn', 'Save to library')}
            </button>
            <a
              href={resultUrl}
              download="postra-slideshow.mp4"
              className="text-[10px] text-newAccent underline"
            >
              {t('clip_text_download', 'Download')}
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
