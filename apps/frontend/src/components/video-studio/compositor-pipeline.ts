import {
  Input,
  Output,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
  ALL_FORMATS,
  CanvasSink,
  CanvasSource,
  EncodedPacketSink,
  EncodedAudioPacketSource,
  QUALITY_MEDIUM,
} from 'mediabunny';

/**
 * Postra Clip — the reusable compositor core (Faza 2).
 *
 * Decode each video frame → let the caller paint overlays (text, logo, captions)
 * on top → re-encode to MP4, while copying the ORIGINAL audio track through
 * untouched. Audio passthrough copies encoded packets without decoding, so it
 * works even where WebCodecs `AudioEncoder` is missing (older iOS Safari).
 *
 * Every Postra Clip feature is this same loop with a different `drawOverlay`.
 */

export interface ComposeOptions {
  /** Source clip. */
  file: Blob;
  /**
   * Paint overlays for the current frame. The decoded frame is already drawn on
   * `ctx`; draw text/logo/captions on top. No-op (omitted) = straight re-encode.
   */
  drawOverlay?: (
    ctx: CanvasRenderingContext2D,
    info: { timestampSec: number; width: number; height: number }
  ) => void;
  /** Progress 0..1, by presentation time. */
  onProgress?: (ratio: number) => void;
  /** Cancel an in-flight compose. */
  signal?: AbortSignal;
  /** Video bitrate (defaults to Mediabunny's QUALITY_MEDIUM). */
  bitrate?: number;
  /** Reject clips longer than this many seconds (defaults to MAX_COMPOSE_SECONDS). */
  maxDurationSec?: number;
}

export interface ComposeResult {
  blob: Blob;
  frames: number;
  /** Whether the original audio track was carried into the output. */
  hadAudio: boolean;
}

/** Thrown when a clip is too long to render in the browser. */
export class ClipTooLongError extends Error {}

/** Thrown when the browser can't decode the clip's video codec (e.g. HEVC). */
export class UnsupportedCodecError extends Error {
  constructor(public readonly codec: string | null) {
    super(`Browser cannot decode video codec: ${codec ?? 'unknown'}`);
  }
}

/**
 * Browser encoding holds the pipeline in memory and runs on the local GPU/CPU,
 * so cap clip length. Longer clips belong on the server-side ffmpeg path.
 */
export const MAX_COMPOSE_SECONDS = 300;

export async function composeVideo(opts: ComposeOptions): Promise<ComposeResult> {
  const { file, drawOverlay, onProgress, signal } = opts;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('No video track in file');

  // Fail with a nameable reason instead of a cryptic decoder error mid-loop —
  // iPhone HEVC clips are the classic case Chrome can't always decode.
  if (!(await videoTrack.canDecode())) {
    throw new UnsupportedCodecError(videoTrack.codec);
  }

  const width = videoTrack.displayWidth;
  const height = videoTrack.displayHeight;
  const duration = await videoTrack.computeDuration();

  if (duration > (opts.maxDurationSec ?? MAX_COMPOSE_SECONDS)) {
    throw new ClipTooLongError();
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');

  const format = new Mp4OutputFormat();
  const output = new Output({ format, target: new BufferTarget() });

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: opts.bitrate ?? QUALITY_MEDIUM,
  });
  output.addVideoTrack(videoSource);

  // Wire up audio passthrough when the source has an audio track whose codec the
  // MP4 container can carry (AAC, etc.). Non-carriable codecs (rare) are skipped
  // here — a server-side ffmpeg remux is the future fallback for those.
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioCodec = audioTrack?.codec ?? null;
  let audioSource: EncodedAudioPacketSource | null = null;
  let audioDecoderConfig: AudioDecoderConfig | null = null;
  if (
    audioTrack &&
    audioCodec &&
    format.getSupportedCodecs().includes(audioCodec)
  ) {
    audioDecoderConfig = await audioTrack.getDecoderConfig();
    if (audioDecoderConfig) {
      audioSource = new EncodedAudioPacketSource(audioCodec);
      output.addAudioTrack(audioSource);
    }
  }

  await output.start();

  // Copy audio packets in decode order, concurrently with the video loop. The
  // first packet carries the decoder config; the muxer interleaves by timestamp.
  const audioPump = (async () => {
    if (!audioSource || !audioTrack) return;
    const sink = new EncodedPacketSink(audioTrack);
    let first = true;
    // AAC priming / edit lists stamp the first packet(s) with a small negative
    // timestamp (e.g. -0.023s) and the muxer rejects negatives — shift the
    // whole track forward by the initial offset; relative timing is preserved.
    let shift = 0;
    for await (const packet of sink.packets()) {
      if (signal?.aborted) break;
      if (first && packet.timestamp < 0) shift = -packet.timestamp;
      const adjusted =
        shift > 0 || packet.timestamp < 0
          ? packet.clone({ timestamp: Math.max(0, packet.timestamp + shift) })
          : packet;
      await audioSource.add(
        adjusted,
        first ? { decoderConfig: audioDecoderConfig! } : undefined
      );
      first = false;
    }
    audioSource.close();
  })();
  // Failures here re-throw at `await audioPump` below; without this parked
  // catch, a rejection during the (long) video loop has no handler attached
  // yet and surfaces as an unhandled rejection (Sentry POSTRA-9).
  audioPump.catch((): undefined => undefined);

  // Decode → composite overlays → encode, frame by frame.
  const videoSink = new CanvasSink(videoTrack);
  let frames = 0;
  try {
    for await (const frame of videoSink.canvases()) {
      if (signal?.aborted) break;
      ctx.drawImage(frame.canvas, 0, 0, width, height);
      drawOverlay?.(ctx, { timestampSec: frame.timestamp, width, height });
      await videoSource.add(frame.timestamp, frame.duration);
      frames += 1;
      if (duration > 0 && frames % 5 === 0) {
        onProgress?.(Math.min(1, frame.timestamp / duration));
      }
    }
  } finally {
    videoSource.close();
  }

  await audioPump;

  if (signal?.aborted) throw new DOMException('Compose aborted', 'AbortError');

  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('Empty output buffer');

  onProgress?.(1);
  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    frames,
    hadAudio: !!audioSource,
  };
}
