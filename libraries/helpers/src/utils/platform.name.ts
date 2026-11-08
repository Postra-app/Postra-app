// A platform's name as the customer reads it on one channel ("LinkedIn",
// "TikTok", "YouTube"), from the provider identifier. Capitalising the
// identifier gave "Linkedin", "Tiktok", "Youtube" and "Linkedin-page", in the
// app and in the publishing notifications and mails alike. Pure, so the
// publishing workflow can use it too.
const NAMES: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  // Instagram without a Facebook Page: the same platform, named once.
  'instagram-standalone': 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  'linkedin-page': 'LinkedIn Page',
  pinterest: 'Pinterest',
  youtube: 'YouTube',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  telegram: 'Telegram',
  x: 'X',
  discord: 'Discord',
  slack: 'Slack',
  wordpress: 'WordPress',
  gmb: 'Google Business',
};

export const platformName = (identifier: string): string => {
  const id = (identifier || '').toLowerCase();
  return NAMES[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : '');
};
