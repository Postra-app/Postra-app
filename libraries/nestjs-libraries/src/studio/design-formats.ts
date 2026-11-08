/**
 * The formats a Studio design can be drawn in, read by both the editor (format
 * bar, "All formats" export) and the server (AI Generate background, server
 * render, request validation). One list, so a format added for the editor is
 * also one the server knows the size of.
 *
 * Labels stay untranslated on purpose: each is a platform name plus an aspect
 * ratio, and neither half translates.
 */
export const DESIGN_FORMATS = [
  { key: 'instagram-feed', label: 'IG Feed (4:5)', width: 1080, height: 1350 },
  { key: 'instagram-square', label: 'IG Square (1:1)', width: 1080, height: 1080 },
  { key: 'instagram-story', label: 'IG Story (9:16)', width: 1080, height: 1920 },
  { key: 'facebook-feed', label: 'FB Feed (1:1)', width: 1080, height: 1080 },
  { key: 'linkedin-feed', label: 'LinkedIn (1:1)', width: 1200, height: 1200 },
  { key: 'tiktok-cover', label: 'TikTok (9:16)', width: 1080, height: 1920 },
  { key: 'x-post', label: 'X Post (16:9)', width: 1600, height: 900 },
  // Pinterest's recommended pin: 2:3. Taller pins get cut in the feed.
  { key: 'pinterest-pin', label: 'Pinterest Pin (2:3)', width: 1000, height: 1500 },
] as const;

export type DesignFormatKey = (typeof DESIGN_FORMATS)[number]['key'];

export const DESIGN_FORMAT_KEYS = DESIGN_FORMATS.map((f) => f.key) as DesignFormatKey[];

export const designFormatByKey = (key?: string) =>
  DESIGN_FORMATS.find((f) => f.key === key);
