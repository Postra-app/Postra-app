import type * as fabric from 'fabric';
import type { PlatformSize } from '../editor.store';
import { StudioIconName } from '@gitroom/frontend/components/studio/studio-icons';

export type TemplateLang = 'pl' | 'en';

export type TemplateCategory =
  | 'promo'
  | 'quote'
  | 'announcement'
  | 'stats'
  | 'tip'
  | 'event'
  | 'community'
  | 'reel-cover';

export interface BrandStyle {
  primary: string;
  background: string;
  text: string;
  fontFamily: string;
}

export interface DesignTemplate {
  key: string;
  category: TemplateCategory;
  label: string;
  labelPl: string;
  description: string;
  descriptionPl: string;
  apply: (
    canvas: fabric.Canvas,
    platform: PlatformSize,
    brand: BrandStyle,
    lang: TemplateLang
  ) => void;
}

export const TEMPLATE_CATEGORIES: {
  key: TemplateCategory;
  labelKey: string;
  fallback: string;
  /** Name in the shared Studio icon set — emoji rendered differently on every
   *  OS and never took the colour of the chip they sat in. */
  icon: StudioIconName;
}[] = [
  { key: 'promo', labelKey: 'tpl_cat_promo', fallback: 'Promo', icon: 'catPromo' },
  { key: 'quote', labelKey: 'tpl_cat_quote', fallback: 'Quote', icon: 'catQuote' },
  { key: 'announcement', labelKey: 'tpl_cat_announcement', fallback: 'Announcement', icon: 'catAnnouncement' },
  { key: 'stats', labelKey: 'tpl_cat_stats', fallback: 'Stats', icon: 'catStats' },
  { key: 'tip', labelKey: 'tpl_cat_tip', fallback: 'Tip', icon: 'catTip' },
  { key: 'event', labelKey: 'tpl_cat_event', fallback: 'Event', icon: 'catEvent' },
  { key: 'community', labelKey: 'tpl_cat_community', fallback: 'Community', icon: 'catCommunity' },
  { key: 'reel-cover', labelKey: 'tpl_cat_reel_cover', fallback: 'Reel cover', icon: 'catReelCover' },
];

export const DEFAULT_BRAND: BrandStyle = {
  primary: '#38bdf8',
  background: '#0a0e1a',
  text: '#ffffff',
  fontFamily: 'Geist, system-ui, sans-serif',
};
