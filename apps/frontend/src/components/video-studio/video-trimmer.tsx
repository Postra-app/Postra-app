'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
} from 'mediabunny';
import WaveSurfer from 'wavesurfer.js';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { safeMediaUrl } from '@gitroom/helpers/utils/safe.media.url';
import { assertVideoSurvives } from './mp4-source';
import { UnsupportedCodecError } from './compositor-pipeline';
import { useRenderJob } from './use-render-job';

interface VideoTrimmerProps {
  file: File | null;
  onTrimmed: (blob: Blob) => void;
}

export const VideoTrimmer: FC<VideoTrimmerProps> = ({ file, onTrimmed }) => {
  const t = useT();
  const toaster = useToaster();
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveContainerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const job = useRenderJob();
  const isExporting = job.busy;
  const progress = job.progress;
  const [undecodable, setUndecodable] = useState(false);

  useEffect(() => {
    // Every reading below belongs to the OLD clip until the new one reports
    // its own. Leaving them in place is how an undecodable file inherited the
    // previous clip's length and kept the export button live: the summary read
    // "Trimmed: 11.51s of 11.51s" for a video that had never loaded.
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setUndecodable(false);
    if (!file) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!videoUrl || !waveContainerRef.current) return;
    const ws = WaveSurfer.create({
      container: waveContainerRef.current,
      waveColor: '#475569',
      progressColor: '#38bdf8',
      cursorColor: '#a78bfa',
      height: 60,
      normalize: true,
      barWidth: 2,
      barGap: 1,
    });
    // The waveform is decorative. Many clips — stock B-roll, photo→video
    // slideshows — have no decodable audio track, and switching files mid-load
    // aborts the decode. Either way WaveSurfer rejects; swallow it so it never
    // surfaces as an unhandled rejection / dev error overlay. Trim still works:
    // duration falls back to the <video> element's onLoadedMetadata.
    ws.on('error', () => {});
    ws.load(videoUrl).catch(() => {});
    ws.on('ready', () => {
      const d = ws.getDuration();
      setDuration(d);
      setTrimStart(0);
      setTrimEnd(d);
    });
    wavesurferRef.current = ws;
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
    };
  }, [videoUrl]);

  const handleVideoLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (duration === 0 && v.duration && Number.isFinite(v.duration)) {
      setDuration(v.duration);
      setTrimEnd(v.duration);
    }
  }, [duration]);

  // The <video> element is the first thing that knows the browser cannot read
  // this file, and it used to say nothing: the frame went black, the stale
  // duration stayed on screen and the failure only surfaced after the user
  // spent a click on Export. Say it here instead, and take the button away.
  const handleVideoError = useCallback(() => {
    setUndecodable(true);
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    wavesurferRef.current?.empty();
    toaster.show(
      t(
        'clip_codec_unsupported',
        "This clip's video format can't be decoded by your browser (often HEVC/H.265 from a phone). Re-export it as a standard MP4 (H.264) and try again."
      ),
      'warning'
    );
  }, [t, toaster]);

  const handleSeekStart = useCallback(() => {
    const v = videoRef.current;
    if (v) v.currentTime = trimStart;
  }, [trimStart]);

  const handleSeekEnd = useCallback(() => {
    const v = videoRef.current;
    if (v) v.currentTime = trimEnd;
  }, [trimEnd]);

  const handleExport = useCallback(async () => {
    if (!file) return;
    if (trimEnd <= trimStart) {
      toaster.show(
        t('video_trim_invalid', 'End point must be after the start point'),
        'warning'
      );
      return;
    }
    try {
      const blob = await job.run(async (signal, registerCancel) => {
        const input = new Input({
          source: new BlobSource(file),
          formats: ALL_FORMATS,
        });
        const output = new Output({
          format: new Mp4OutputFormat(),
          target: new BufferTarget(),
        });
        const conversion = await Conversion.init({
          input,
          output,
          trim: { start: trimStart, end: trimEnd },
        });
        registerCancel(() => conversion.cancel());
        // A clip whose video we can't decode still converts "successfully" as
        // long as its audio survives — the user would get sound over a black
        // screen with no error anywhere. Say so before spending the render.
        assertVideoSurvives(conversion);
        conversion.onProgress = (p) => job.setProgress(Math.round(p * 100));
        await conversion.execute();
        const buffer = (output.target as BufferTarget).buffer;
        if (!buffer) throw new Error('empty buffer');
        return new Blob([buffer], { type: 'video/mp4' });
      });
      if (!blob) return;
      onTrimmed(blob);
    } catch (err) {
      toaster.show(
        err instanceof UnsupportedCodecError
          ? t(
              'clip_codec_unsupported',
              "This clip's video format can't be decoded by your browser (often HEVC/H.265 from a phone). Re-export it as a standard MP4 (H.264) and try again."
            )
          : t(
              'video_trim_failed',
              'Video trimming failed. Check that your browser supports WebCodecs (Chrome, Edge or Safari 16.4+).'
            ),
        'warning'
      );
    }
  }, [file, trimStart, trimEnd, onTrimmed, t, toaster, job]);

  if (!file) {
    return (
      <div className="text-xs text-textColor/60 p-4 text-center">
        {t('video_select_file', 'Choose a video file to get started.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {videoUrl && (
        <video
          ref={videoRef}
          src={safeMediaUrl(videoUrl)}
          controls
          onLoadedMetadata={handleVideoLoaded}
          onError={handleVideoError}
          className="w-full max-h-[300px] rounded bg-black"
        />
      )}
      <div ref={waveContainerRef} className="w-full bg-white/[0.03] rounded" />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-textColor/60">
            {t('video_trim_start', 'Start')}: {trimStart.toFixed(2)}s
          </label>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={trimStart}
            onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 0.1))}
            onMouseUp={handleSeekStart}
            onTouchEnd={handleSeekStart}
            disabled={isExporting}
            className="w-full"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-textColor/60">
            {t('video_trim_end', 'End')}: {trimEnd.toFixed(2)}s
          </label>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={trimEnd}
            onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.1))}
            onMouseUp={handleSeekEnd}
            onTouchEnd={handleSeekEnd}
            disabled={isExporting}
            className="w-full"
          />
        </div>
      </div>
      <div className="text-[11px] text-textColor/70">
        {undecodable
          ? t(
              'video_trim_undecodable',
              "Your browser can't read this clip, so there is nothing to trim."
            )
          : t('video_trim_summary', 'Trimmed: {sec}s of {total}s')
              .replace('{sec}', (trimEnd - trimStart).toFixed(2))
              .replace('{total}', duration.toFixed(2))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={handleExport}
          disabled={isExporting || undecodable || trimEnd <= trimStart}
          className="self-start"
        >
          {isExporting
            ? `${t('video_exporting', 'Exporting')} ${progress}%`
            : t('video_export_trimmed', 'Export trimmed clip')}
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
