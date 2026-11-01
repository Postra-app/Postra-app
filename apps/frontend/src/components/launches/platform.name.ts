import { PLATFORM_NAMES } from '@gitroom/frontend/components/billing/plan.features';

// A platform's name as the customer reads it on one channel ("LinkedIn",
// "TikTok", "YouTube"), from the provider identifier in a URL. Capitalising
// the identifier gave "Linkedin", "Tiktok" and "Youtube".
const SINGLE: Record<string, string> = {
  'linkedin-page': 'LinkedIn Page',
  gmb: 'Google Business',
};

export const platformName = (identifier: string): string => {
  const id = (identifier || '').toLowerCase();
  return (
    SINGLE[id] ||
    PLATFORM_NAMES[id] ||
    (id ? id.charAt(0).toUpperCase() + id.slice(1) : '')
  );
};
