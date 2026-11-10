'use client';

import { FC, useState } from 'react';

// Render a duration in seconds as M:SS for the thumbnail length badge.
const formatSeconds = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const VideoFrame: FC<{
  url: string;
  autoplay?: boolean;
  // Full native player (play/pause, seek bar, time, volume, fullscreen).
  // Off by default so grid thumbnails stay clean — they get a length badge.
  controls?: boolean;
  // A still the server took (Media.poster) or the customer's cover: shown
  // before the video loads, and where the browser draws nothing for #t=1
  // (Safari on iOS with preload="metadata").
  poster?: string | null;
}> = (props) => {
  const { url, autoplay, controls, poster } = props;
  const [duration, setDuration] = useState<number | null>(null);
  return (
    <div className="relative w-full h-full">
      <video
        className={`w-full h-full rounded-[4px] ${
          controls ? 'object-contain' : 'object-cover'
        }`}
        // Thumbnails seek to 1s for a meaningful poster frame; the full player
        // starts at 0 so the seek bar spans the whole clip.
        src={controls ? url : url + '#t=1'}
        preload="metadata"
        poster={poster || undefined}
        autoPlay={!!autoplay}
        controls={!!controls}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setDuration(Number.isFinite(d) ? d : null);
        }}
      />
      {/* On thumbnails (no native controls) show the clip length in the corner
          — the standard "how long is this" affordance, visible at a glance
          without opening any settings. */}
      {!controls && duration !== null && (
        <div className="absolute bottom-[4px] end-[4px] px-[5px] py-[1px] rounded-[4px] bg-black/70 text-white text-[10px] leading-[14px] font-[500] pointer-events-none">
          {formatSeconds(duration)}
        </div>
      )}
    </div>
  );
};
