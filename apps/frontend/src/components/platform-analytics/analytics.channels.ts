// Channels that have a page on Analytics. TikTok reads its numbers with
// user.info.stats and video.list; a channel connected before it had them
// shows empty cards with "tap to refresh the channel", and reconnecting it
// once fixes that. LinkedIn Pages and Google Business stay for the channels
// connected before (LinkedIn) and the preview (Google).
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
  'tiktok',
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
  'TikTok',
];
