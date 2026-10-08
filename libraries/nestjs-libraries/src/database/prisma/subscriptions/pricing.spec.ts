import {
  channelLimitFor,
  planLabel,
  planLabels,
  postsCycleStart,
  pricing,
  TRIAL_CHANNEL_CAP,
  trialAiAllowance,
} from './pricing';

// Pins the paid-plan matrix so an upstream sync (Postiz ships different
// tiers/prices) or a careless edit cannot silently change what customers pay
// for. If one of these fails, the change must be deliberate: update the test
// together with Stripe prices and the landing/pricing copy.
describe('pricing matrix', () => {
  it('keeps GBP prices at £12/£29/£79 (yearly = 10x monthly)', () => {
    expect(pricing.FREE.month_price).toBe(0);
    expect(pricing.STANDARD.month_price).toBe(12);
    expect(pricing.PRO.month_price).toBe(29);
    expect(pricing.ULTIMATE.month_price).toBe(79);
    for (const tier of ['STANDARD', 'PRO', 'ULTIMATE']) {
      expect(pricing[tier].year_price).toBe(pricing[tier].month_price * 10);
    }
  });

  it('keeps channel slots at FREE=3, Starter=3, Pro=6, Business=12', () => {
    expect(pricing.FREE.channel).toBe(3);
    expect(pricing.STANDARD.channel).toBe(3);
    expect(pricing.PRO.channel).toBe(6);
    expect(pricing.ULTIMATE.channel).toBe(12);
  });

  it('gives Business a slot for every provider in its allowlist', () => {
    expect(pricing.ULTIMATE.channel).toBe(
      pricing.ULTIMATE.allowedProviders.length
    );
  });

  it('keeps the per-tier platform allowlists', () => {
    expect(pricing.STANDARD.allowedProviders).toEqual([
      'facebook',
      'instagram',
      'tiktok',
      'linkedin',
    ]);
    expect(pricing.PRO.allowedProviders).toEqual([
      'facebook',
      'instagram',
      'tiktok',
      'linkedin',
      'youtube',
      'threads',
      'linkedin-page',
      'bluesky',
      'mastodon',
      'telegram',
    ]);
    expect(pricing.ULTIMATE.allowedProviders).toEqual([
      'facebook',
      'instagram',
      'tiktok',
      'linkedin',
      'youtube',
      'threads',
      'linkedin-page',
      'bluesky',
      'mastodon',
      'telegram',
      'x',
      'discord',
    ]);
  });

  it('nests tiers: every platform of a lower tier is in the higher one', () => {
    const chain = [
      pricing.FREE,
      pricing.STANDARD,
      pricing.PRO,
      pricing.ULTIMATE,
    ];
    for (let i = 1; i < chain.length; i++) {
      for (const provider of chain[i - 1].allowedProviders) {
        expect(chain[i].allowedProviders).toContain(provider);
      }
    }
  });

  it('defines a non-empty allowlist for every tier (enforcement fallback)', () => {
    for (const tier of Object.keys(pricing)) {
      expect(pricing[tier].allowedProviders.length).toBeGreaterThan(0);
    }
  });

  it('gives each tier at least as many platforms as channel slots', () => {
    for (const tier of Object.keys(pricing)) {
      // Every provider is its own picker tile and consumes its own slot —
      // including linkedin-page, which connects separately from linkedin.
      expect(pricing[tier].allowedProviders.length).toBeGreaterThanOrEqual(
        pricing[tier].channel || 0
      );
    }
  });

  it('never grants linkedin-page without the personal linkedin profile', () => {
    // One-way on purpose: Starter gets the personal profile while company
    // Pages stay a Pro upgrade lever.
    for (const tier of Object.keys(pricing)) {
      const list = pricing[tier].allowedProviders;
      if (list.includes('linkedin-page')) {
        expect(list).toContain('linkedin');
      }
    }
  });

  it('keeps company LinkedIn Pages out of Starter (Pro upgrade lever)', () => {
    expect(pricing.STANDARD.allowedProviders).not.toContain('linkedin-page');
    expect(pricing.PRO.allowedProviders).toContain('linkedin-page');
  });

  it('keeps FREE inert — trials run on paid tiers, not on FREE', () => {
    expect(pricing.FREE.posts_per_month).toBe(0);
    expect(pricing.FREE.ai).toBe(false);
  });

  it('sets team seats (owner-inclusive) to Starter=1, Pro=2, Business=5', () => {
    expect(pricing.STANDARD.team_members).toBe(1);
    expect(pricing.PRO.team_members).toBe(2);
    expect(pricing.ULTIMATE.team_members).toBe(5);
  });

  it('keeps agent-chat budgets: FREE=0, Starter=1.5M, Pro=4M, Business=10M weighted tokens', () => {
    expect(pricing.FREE.agent_tokens).toBe(0);
    expect(pricing.STANDARD.agent_tokens).toBe(1_500_000);
    expect(pricing.PRO.agent_tokens).toBe(4_000_000);
    expect(pricing.ULTIMATE.agent_tokens).toBe(10_000_000);
  });

  it('gives Starter AI images (not videos); videos start at Pro', () => {
    expect(pricing.STANDARD.image_generator).toBe(true);
    expect(pricing.STANDARD.image_generation_count).toBe(30);
    expect(pricing.STANDARD.generate_videos).toBe(0);
    expect(pricing.PRO.generate_videos).toBe(30);
    expect(pricing.ULTIMATE.generate_videos).toBe(60);
  });
});

// E2E-07-39: the limits the landing and Help promise, pinned, so a change in
// pricing.ts has to be a deliberate change here too (and of the landing).
describe('pricing limits the landing promises', () => {
  it('keeps posts a month: Starter 400, Pro and Business unlimited', () => {
    expect(pricing.STANDARD.posts_per_month).toBe(400);
    expect(pricing.PRO.posts_per_month).toBe(1_000_000);
    expect(pricing.ULTIMATE.posts_per_month).toBe(1_000_000);
  });

  it('keeps webhooks at FREE=0, Starter=2, Pro=30, Business=10000', () => {
    expect(pricing.FREE.webhooks).toBe(0);
    expect(pricing.STANDARD.webhooks).toBe(2);
    expect(pricing.PRO.webhooks).toBe(30);
    expect(pricing.ULTIMATE.webhooks).toBe(10_000);
  });

  it('keeps Auto Post at Pro=3 and Business=10 feeds, none below', () => {
    expect([pricing.FREE.autoPost, pricing.FREE.autoPostLimit]).toEqual([false, 0]);
    expect([pricing.STANDARD.autoPost, pricing.STANDARD.autoPostLimit]).toEqual([false, 0]);
    expect([pricing.PRO.autoPost, pricing.PRO.autoPostLimit]).toEqual([true, 3]);
    expect([pricing.ULTIMATE.autoPost, pricing.ULTIMATE.autoPostLimit]).toEqual([true, 10]);
  });

  it('keeps AI images a month at FREE=0, Starter=30, Pro=150, Business=600', () => {
    expect(pricing.FREE.image_generation_count).toBe(0);
    expect(pricing.STANDARD.image_generation_count).toBe(30);
    expect(pricing.PRO.image_generation_count).toBe(150);
    expect(pricing.ULTIMATE.image_generation_count).toBe(600);
  });

  it('includes the public API in every paid plan, not in FREE', () => {
    expect(pricing.FREE.public_api).toBe(false);
    for (const tier of ['STANDARD', 'PRO', 'ULTIMATE'] as const) {
      expect(pricing[tier].public_api).toBe(true);
    }
  });

  // TEAM is no longer sold; organisations that had it keep these limits.
  it('keeps the legacy TEAM tier as it was', () => {
    const { channel, posts_per_month, image_generation_count, team_members, webhooks, autoPost, autoPostLimit, public_api } =
      pricing.TEAM;
    expect({ channel, posts_per_month, image_generation_count, team_members, webhooks, autoPost, autoPostLimit, public_api }).toEqual({
      channel: 10,
      posts_per_month: 1_000_000,
      image_generation_count: 100,
      team_members: 1_000_000,
      webhooks: 10,
      autoPost: true,
      autoPostLimit: 5,
      public_api: true,
    });
  });
});

describe('planLabel', () => {
  it('maps internal enum keys to user-facing names', () => {
    expect(planLabels.FREE).toBe('Trial');
    expect(planLabels.STANDARD).toBe('Starter');
    expect(planLabels.PRO).toBe('Pro');
    expect(planLabels.ULTIMATE).toBe('Business');
  });

  it('falls back to the raw tier for unknown keys and empty for none', () => {
    expect(planLabel('LEGACY')).toBe('LEGACY');
    expect(planLabel(null)).toBe('');
    expect(planLabel(undefined)).toBe('');
  });
});

describe('channelLimitFor', () => {
  it('caps a trialing org at TRIAL_CHANNEL_CAP regardless of tier', () => {
    expect(
      channelLimitFor({ isTrailing: true, subscription: { totalChannels: 10 } })
    ).toBe(TRIAL_CHANNEL_CAP);
    expect(
      channelLimitFor({ isTrailing: true, subscription: { totalChannels: 6 } })
    ).toBe(TRIAL_CHANNEL_CAP);
  });

  it('never caps below the cheapest paid tier', () => {
    expect(TRIAL_CHANNEL_CAP).toBeLessThanOrEqual(pricing.STANDARD.channel!);
  });

  it('does not raise a trialing org above its own tier', () => {
    expect(
      channelLimitFor({ isTrailing: true, subscription: { totalChannels: 3 } })
    ).toBe(3);
    // trialing before checkout: no subscription yet, FREE limit applies
    expect(channelLimitFor({ isTrailing: true, subscription: null })).toBe(
      pricing.FREE.channel
    );
  });

  it('gives converted (non-trialing) orgs their full quota', () => {
    expect(
      channelLimitFor({ isTrailing: false, subscription: { totalChannels: 10 } })
    ).toBe(10);
  });

  it('falls back to the FREE limit without a subscription', () => {
    expect(channelLimitFor({ isTrailing: false, subscription: null })).toBe(
      pricing.FREE.channel
    );
    expect(channelLimitFor(undefined)).toBe(pricing.FREE.channel);
  });
});

describe('trialAiAllowance', () => {
  it('runs a trial on Starter’s AI pool, whatever the tier', () => {
    expect(
      trialAiAllowance(pricing.ULTIMATE.image_generation_count, true, 'image_generation_count')
    ).toBe(pricing.STANDARD.image_generation_count);
    expect(
      trialAiAllowance(pricing.PRO.agent_tokens, true, 'agent_tokens')
    ).toBe(pricing.STANDARD.agent_tokens);
  });

  it('leaves a paid plan its full pool', () => {
    expect(
      trialAiAllowance(pricing.ULTIMATE.image_generation_count, false, 'image_generation_count')
    ).toBe(pricing.ULTIMATE.image_generation_count);
  });
});

describe('postsCycleStart', () => {
  it('starts the current cycle on the anniversary day', () => {
    const anchor = new Date();
    anchor.setMonth(anchor.getMonth() - 3);
    anchor.setDate(anchor.getDate() - 1);
    const start = postsCycleStart(anchor);
    expect(start.getTime()).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - start.getTime()).toBeLessThan(32 * 24 * 3600 * 1000);
  });
});
