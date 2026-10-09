import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  PLATFORM_NAMES,
  SOON_PLATFORMS,
  planFeatures,
  planFeatureText,
} from '@gitroom/frontend/components/billing/plan.features';

const texts = (tier: string) => planFeatures(tier).map(planFeatureText);

describe('planFeatures', () => {
  it('lists Starter as the customer sees it', () => {
    expect(texts('STANDARD')).toEqual([
      '3 channels',
      'On Facebook, Instagram, TikTok, LinkedIn',
      '400 posts a month',
      '1 person',
      'AI writer, assistant and auto-complete',
      '75 AI images a month',
      '15 AI videos a month',
      'Studio image editor',
      'Blog to posts from 2 RSS feeds',
      'Public API and 2 webhooks',
    ]);
  });

  it('shows what Pro adds: platforms and Blog to posts', () => {
    const pro = texts('PRO');
    expect(pro).toContain(
      // Only platforms a customer can connect today, like the landing's
      // "6 channels on 9 platforms" (K. 10-09: no "(soon)").
      'On Facebook, Instagram, TikTok, LinkedIn, YouTube, Threads, Bluesky, Mastodon, Telegram'
    );
    expect(pro).toContain('Blog to posts from 3 RSS feeds');
    expect(pro).toContain('Unlimited posts');
    expect(pro).toContain('2 people');
    expect(pro).toContain('30 AI videos a month');
    expect(texts('ULTIMATE')).toContain('60 AI videos a month');
  });

  it('names every platform a plan unlocks, nothing more', () => {
    for (const tier of ['STANDARD', 'PRO', 'ULTIMATE']) {
      const line = texts(tier).find((t) => t.startsWith('On '))!;
      expect(line).toBe(
        'On ' +
          pricing[tier].allowedProviders
            .filter((p) => !SOON_PLATFORMS.has(p))
            .map((p) => PLATFORM_NAMES[p])
            .join(', ')
      );
    }
  });

  it('has a display name for every platform any plan allows', () => {
    for (const tier of Object.keys(pricing)) {
      for (const p of pricing[tier].allowedProviders) {
        expect(PLATFORM_NAMES[p]).toBeDefined();
      }
    }
  });

  it('never promises Blog to posts on a plan without it', () => {
    expect(texts('FREE').some((t) => t.startsWith('Blog to posts'))).toBe(
      false
    );
  });

  it('says unlimited webhooks on Business instead of 10000', () => {
    expect(texts('ULTIMATE')).toContain('Public API and unlimited webhooks');
  });
});
