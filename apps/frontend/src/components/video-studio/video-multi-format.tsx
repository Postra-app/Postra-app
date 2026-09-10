'use client';

import { FC, useCallback, useState } from 'react';
import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
} from 'mediabunny';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { VIDEO_FORMATS, VideoFormat } from './video-formats';
import { assertVideoSurvives } from './mp4-source';
import { useRenderJob } from './use-render-job';
import { UnsupportedCodecError } from './compositor-pipeline';

interface VideoMultiFormatProps {
  source: Blob | null;
  onExported: (results: { format: VideoFormat; blob: Blob }[]) => void;
}

export const VideoMultiFormat: FC<VideoMultiFormatProps> = ({ source, onExported }) => {
  const t = useT();
  const toaster = useToaster();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(VIDEO_FORMATS.map((f) => f.key))
  );
  const job = useRenderJob();
  const isExporting = job.busy;
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const handleExport = useCallback(async () => {
    if (!source) return;
    if (selected.size === 0) {
      toaster.show(
        t('video_format_select_one', 'Select at least one format'),
        'warning'
      );
      return;
    }
    try {
      const results = await job.run(async (signal, registerCancel) => {
        const done: { format: VideoFormat; blob: Blob }[] = [];
        const targets = VIDEO_FORMATS.filter((f) => selected.has(f.key));
        for (const fmt of targets) {
          // Cancelling during format two must not start format three.
          if (signal.aborted) break;
          const input = new Input({
            source: new BlobSource(source),
            formats: ALL_FORMATS,
          });
          const output = new Output({
            format: new Mp4OutputFormat(),
            target: new BufferTarget(),
          });
          const conversion = await Conversion.init({
            input,
            output,
            video: { width: fmt.width, height: fmt.height, fit: 'cover' },
          });
          registerCancel(() => conversion.cancel());
          // Resizing forces a decode. If the source codec can't be decoded the
          // video track is dropped and the "successful" export is audio-only —
          // catch it on the first format instead of writing three mute files.
          assertVideoSurvives(conversion);
          conversion.onProgress = (p) =>
            setProgressMap((prev) => ({ ...prev, [fmt.key]: Math.round(p * 100) }));
          await conversion.execute();
          const buffer = (output.target as BufferTarget).buffer;
          if (!buffer) throw new Error(`empty buffer for ${fmt.key}`);
          done.push({
            format: fmt,
            blob: new Blob([buffer], { type: 'video/mp4' }),
          });
        }
        return done;
      });
      if (!results) return;
      onExported(results);
    } catch (err) {
      toaster.show(
        err instanceof UnsupportedCodecError
          ? t(
              'clip_codec_unsupported',
              "This clip's video format can't be decoded by your browser (often HEVC/H.265 from a phone). Re-export it as a standard MP4 (H.264) and try again."
            )
          : t(
              'video_format_failed',
              'Multi-format export failed. Check that your browser supports WebCodecs (Chrome, Edge or Safari 16.4+).'
            ),
        'warning'
      );
    }
  }, [source, selected, onExported, t, toaster, job]);

  if (!source) {
    return (
      <div className="text-xs text-textColor/60 p-4 text-center">
        {t('video_no_source', 'Load a video first (From disk / From library) to pick formats.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs text-textColor/80">
        {t(
          'video_format_explainer',
          'Generates a separate MP4 file for each selected format (smart center-crop).'
        )}
      </div>
      <div className="flex flex-col gap-2">
        {VIDEO_FORMATS.map((fmt) => {
          const checked = selected.has(fmt.key);
          const progress = progressMap[fmt.key];
          return (
            <label
              key={fmt.key}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded border cursor-pointer transition-colors ${
                checked
                  ? 'bg-newAccent/10 border-newAccent'
                  : 'bg-newColColor border-newBorder'
              } ${isExporting ? 'opacity-60 cursor-not-allowed' : 'hover:border-newAccent/60'}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(fmt.key)}
                  disabled={isExporting}
                />
                <div className="text-xs">
                  <div className="text-textColor">{fmt.label}</div>
                  <div className="text-[11px] text-textColor/65">
                    {fmt.width}×{fmt.height}
                  </div>
                </div>
              </div>
              {progress !== undefined && progress < 100 && (
                <div className="text-[11px] text-textColor/70">{progress}%</div>
              )}
              {progress === 100 && <div className="text-[11px] text-green-400">✓</div>}
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={handleExport}
          disabled={isExporting || selected.size === 0}
          className="self-start"
        >
          {isExporting
            ? t('video_format_exporting', 'Exporting {n} formats...').replace(
                '{n}',
                String(selected.size)
              )
            : t('video_format_export', 'Export {n} formats').replace(
                '{n}',
                String(selected.size)
              )}
        </Button>
        {isExporting && (
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
    </div>
  );
};

export type { VideoFormat };
