// Channels that have a page on Analytics. TikTok is left out: the scopes
// that read its numbers (user.info.stats, video.list) were cut for TikTok's
// App Review, so its page only ever showed empty cards and a "tap to refresh
// the channel" that sent people to reconnect for nothing. It comes back when
// TikTok grants them. LinkedIn Pages and Google Business stay for the
// channels connected before (LinkedIn) and the preview (Google).
export const ANALYTICS_CHANNELS = [
  'facebook',
  'instagram',
  'instagram-standalone',
  'linkedin-page',
  'youtube',
  'gmb',
  'pinterest',
  'threads',
  'x',
];

// What the empty page tells customers they can add: the platforms they can
// connect today, by name (it printed "Instagram-standalone, Linkedin-page,
// Tiktok, Gmb").
export const ANALYTICS_SUPPORTED_NAMES = [
  'Facebook',
  'Instagram',
  'Threads',
  'X',
  'YouTube',
  'Pinterest',
];
