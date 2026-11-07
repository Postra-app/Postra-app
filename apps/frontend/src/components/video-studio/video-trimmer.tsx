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
import RegionsPlugin, {
  type Region,
} from 'wavesurfer.js/dist/plugins/regions.js';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { safeMediaUrl } from '@gitroom/helpers/utils/safe.media.url';
import { assertVideoSurvives } from './mp4-source';
import { UnsupportedCodecError } from './compositor-pipeline';
import { useRenderJob } from './use-render-job';
import { moveTrimEdge } from './trim-edges';

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
  const regionRef = useRef<Region | null>(null);
  // Set while a clip's audio could not be decoded and the flat waveform is
  // still waiting for the video's duration.
  const flatWaveRef = useRef<(() => void) | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  // The edges as last set, for the waveform's `ready`: the sliders work from
  // the video's metadata, which arrives before the sound is decoded (in Safari
  // well before), and an edge moved in between must survive the region.
  const trimRef = useRef({ start: 0, end: 0 });
  useEffect(() => {
    trimRef.current = { start: trimStart, end: trimEnd };
  }, [trimStart, trimEnd]);
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
    // One draggable region on the waveform, instead of two range inputs that
    // had no visible relation to the sound they were cutting.
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: waveContainerRef.current,
      waveColor: '#475569',
      progressColor: '#38bdf8',
      cursorColor: '#a78bfa',
      height: 88,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      plugins: [regions],
    });
    // Many clips — screen recordings, muted exports, photo→video slideshows —
    // have no decodable audio track. WaveSurfer then errors and never reaches
    // `ready`, where the region is made, and the region is the only way to set
    // start and end: such a clip could not be trimmed at all.
    // Load it again with a flat waveform of the video's length instead; given
    // peaks, WaveSurfer skips decoding and `ready` follows. The video may not
    // know its duration yet, in which case onLoadedMetadata finishes the job.
    // Switching files mid-load also errors; the rejection is swallowed so it
    // never surfaces as an unhandled rejection / dev error overlay.
    // The clip is handed over as its bytes, never as the blob: URL. Given a
    // URL, WaveSurfer fetch()es it, and the enforced connect-src has no blob:
    // - every clip errored into the flat line below and the waveform this
    // tool is built around never showed.
    const source = file;
    if (!source) return;
    let flatLoaded = false;
    const loadFlat = () => {
      const d = videoRef.current?.duration;
      if (flatLoaded || !d || !Number.isFinite(d)) return;
      flatLoaded = true;
      flatWaveRef.current = null;
      ws.loadBlob(source, [[0, 0]], d).catch(() => {});
    };
    ws.on('error', () => {
      if (flatLoaded) return;
      flatWaveRef.current = loadFlat;
      loadFlat();
    });
    ws.loadBlob(source).catch(() => {});
    ws.on('ready', () => {
      const d = ws.getDuration();
      const set = trimRef.current;
      const keep = set.end > set.start && set.start < d;
      const start = keep ? set.start : 0;
      const end = keep ? Math.min(set.end, d) : d;
      setDuration(d);
      setTrimStart(start);
      setTrimEnd(end);
      regions.clearRegions();
      regionRef.current = regions.addRegion({
        start,
        end,
        color: 'rgba(56,189,248,0.18)',
        drag: true,
        resize: true,
      });
    });
    // Dragging the whole region moves both ends; dragging a handle moves one.
    // Either way the numbers below follow the picture, not the other way round.
    regions.on('region-updated', (region: Region, side?: 'start' | 'end') => {
      setTrimStart(region.start);
      setTrimEnd(region.end);
      const v = videoRef.current;
      if (v) v.currentTime = side === 'end' ? region.end : region.start;
    });
    wavesurferRef.current = ws;
    return () => {
      regionRef.current = null;
      flatWaveRef.current = null;
      ws.destroy();
      wavesurferRef.current = null;
    };
    // `file` and `videoUrl` change together; the URL is the one to wait for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // The region's edges could only be dragged with a mouse. The Start and End
  // readouts are sliders for the keyboard: arrows move an edge by 0.1 s,
  // Shift+arrows by a second, Home/End to the ends of the clip.
  const moveEdge = useCallback(
    (side: 'start' | 'end', to: number) => {
      if (!duration) return;
      // Before the waveform is ready there is no region yet; the edges then
      // live in state alone and the region is made from them.
      const region = regionRef.current;
      const { start, end } = moveTrimEdge(
        side,
        to,
        region ? { start: region.start, end: region.end } : trimRef.current,
        duration
      );
      region?.setOptions({ start, end });
      setTrimStart(start);
      setTrimEnd(end);
      const v = videoRef.current;
      if (v) v.currentTime = side === 'end' ? end : start;
    },
    [duration]
  );

  const edgeKeyDown = useCallback(
    (side: 'start' | 'end') => (e: React.KeyboardEvent) => {
      const current = side === 'start' ? trimStart : trimEnd;
      const step = e.shiftKey ? 1 : 0.1;
      const target =
        e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? current - step
          : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? current + step
          : e.key === 'Home'
          ? 0
          : e.key === 'End'
          ? duration
          : null;
      if (target === null) return;
      e.preventDefault();
      moveEdge(side, target);
    },
    [trimStart, trimEnd, duration, moveEdge]
  );

  const handleVideoLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (duration === 0 && v.duration && Number.isFinite(v.duration)) {
      setDuration(v.duration);
      setTrimEnd(v.duration);
    }
    flatWaveRef.current?.();
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
          // An iPhone clip is HEVC, which X and LinkedIn refuse; an H.264
          // clip is copied as before.
          video: { codec: 'avc' },
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
      <div className="flex items-center justify-between text-[11px] text-textColor/60">
        <span
          role="slider"
          tabIndex={duration ? 0 : -1}
          aria-label={t('video_trim_start', 'Start')}
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(2))}
          aria-valuenow={Number(trimStart.toFixed(2))}
          aria-valuetext={`${trimStart.toFixed(2)}s`}
          onKeyDown={edgeKeyDown('start')}
          className="rounded px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-newAccent"
        >
          {t('video_trim_start', 'Start')}: {trimStart.toFixed(2)}s
        </span>
        <span className="text-textColor/45">
          {t('video_trim_drag_hint', 'Drag the highlighted part, or its edges.')}
        </span>
        <span
          role="slider"
          tabIndex={duration ? 0 : -1}
          aria-label={t('video_trim_end', 'End')}
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(2))}
          aria-valuenow={Number(trimEnd.toFixed(2))}
          aria-valuetext={`${trimEnd.toFixed(2)}s`}
          onKeyDown={edgeKeyDown('end')}
          className="rounded px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-newAccent"
        >
          {t('video_trim_end', 'End')}: {trimEnd.toFixed(2)}s
        </span>
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
