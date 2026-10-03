import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// What each plan includes, as the customer reads it on the paywall and in
// Billing. Built from pricing.ts so the list can never promise more (or less)
// than the backend enforces; the landing page (postra.co.uk) says the same.
export interface PlanFeature {
  key: string;
  text: string;
  vars?: Record<string, string | number>;
}

export const PLATFORM_NAMES: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  threads: 'Threads',
  'linkedin-page': 'LinkedIn Pages',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  telegram: 'Telegram',
  x: 'X',
  discord: 'Discord',
};

const UNLIMITED = 10000;

export const planFeatures = (tier: string): PlanFeature[] => {
  const plan = pricing[tier];
  if (!plan) {
    return [];
  }
  const list: PlanFeature[] = [];
  const channels = plan.channel || 0;

  list.push(
    channels === 1
      ? { key: 'billing_plan_channel', text: '1 channel' }
      : {
          key: 'billing_plan_channels',
          text: '{{count}} channels',
          vars: { count: channels },
        }
  );
  list.push({
    key: 'billing_plan_platforms',
    text: 'On {{platforms}}',
    vars: {
      platforms: plan.allowedProviders
        .map((p) => PLATFORM_NAMES[p] || p)
        .join(', '),
    },
  });
  list.push(
    plan.posts_per_month > UNLIMITED
      ? { key: 'billing_plan_posts_unlimited', text: 'Unlimited posts' }
      : {
          key: 'billing_plan_posts',
          text: '{{count}} posts a month',
          vars: { count: plan.posts_per_month },
        }
  );
  list.push(
    plan.team_members === 1
      ? { key: 'billing_plan_person', text: '1 person' }
      : {
          key: 'billing_plan_people',
          text: '{{count}} people',
          vars: { count: plan.team_members },
        }
  );
  if (plan.ai) {
    list.push({
      key: 'billing_plan_ai',
      text: 'AI writer, assistant and auto-complete',
    });
  }
  if (plan.image_generator) {
    list.push({
      key: 'billing_plan_images',
      text: '{{count}} AI images a month',
      vars: { count: plan.image_generation_count },
    });
  }
  list.push({ key: 'billing_plan_studio', text: 'Studio image editor' });
  if (plan.autoPost && plan.autoPostLimit > 0) {
    list.push({
      key: 'billing_plan_autopost',
      text: 'Blog to posts from {{count}} RSS feeds',
      vars: { count: plan.autoPostLimit },
    });
  }
  if (plan.public_api) {
    list.push(
      plan.webhooks >= UNLIMITED
        ? {
            key: 'billing_plan_api_unlimited',
            text: 'Public API and unlimited webhooks',
          }
        : {
            key: 'billing_plan_api',
            text: 'Public API and {{count}} webhooks',
            vars: { count: plan.webhooks },
          }
    );
  }
  return list;
};

// Plain English, for tests and anywhere without a translator.
export const planFeatureText = (f: PlanFeature) =>
  f.text.replace(/{{(\w+)}}/g, (_, k) => String(f.vars?.[k] ?? ''));
