/** Shared output formats for Postra Clip (slideshow, multi-format export). */
export interface VideoFormat {
  key: string;
  label: string;
  width: number;
  height: number;
}

export const VIDEO_FORMATS: VideoFormat[] = [
  { key: 'vertical-9-16', label: 'IG Reel / TikTok / Story (9:16)', width: 1080, height: 1920 },
  // The feed's own shape on Instagram and Facebook: a 4:5 clip fills more of
  // the screen than a square one.
  { key: 'portrait-4-5', label: 'IG / FB Feed (4:5)', width: 1080, height: 1350 },
  { key: 'square-1-1', label: 'IG Feed (1:1)', width: 1080, height: 1080 },
  { key: 'landscape-16-9', label: 'YouTube / X (16:9)', width: 1920, height: 1080 },
];
