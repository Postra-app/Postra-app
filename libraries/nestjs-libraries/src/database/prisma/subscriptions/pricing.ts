export interface PricingInnerInterface {
  current: string;
  month_price: number;
  year_price: number;
  channel?: number;
  // Platform identifiers a tier may connect. `channel` still caps the TOTAL
  // number of channels; this caps WHICH platforms unlock. Enforced at connect
  // (integrations.controller.getIntegrationUrl) and on downgrade
  // (subscription.service.modifySubscription). Edit this list to move a
  // platform between tiers. NOTE: a platform must ALSO be in
  // integration.manager `enabledProviders` to appear in the picker — e.g. `x`
  // is listed for ULTIMATE here but stays hidden until enabled globally.
  allowedProviders: string[];
  posts_per_month: number;
  // Team seat allowance INCLUDING the owner. 1 = solo (owner only, cannot
  // invite). Enforced at invite (permissions.service TEAM_MEMBERS) and
  // reconciled on tier change (subscription.service → reconcileTeamSeats).
  team_members: number;
  community_features: boolean;
  featured_by_gitroom: boolean;
  ai: boolean;
  import_from_channels: boolean;
  image_generator?: boolean;
  image_generation_count: number;
  generate_videos: number;
  public_api: boolean;
  webhooks: number;
  autoPost: boolean;
  // Max number of RSS autopost feeds an org may run concurrently. Each feed
  // polls hourly and burns AI tokens per new article, so it is capped per plan
  // independently of the `autoPost` on/off flag.
  autoPostLimit: number;
  // Monthly budget for the gpt-5.5 agent chat, in WEIGHTED tokens:
  // input + 6×output (output costs 6× input — $30 vs $5 per 1M). This is the
  // only text-AI surface without a natural cap (posts_per_month caps the
  // creator, autoPostLimit caps RSS), so a heavy chatter could otherwise burn
  // more than the plan price. Budgets keep worst-case agent COGS at ~25-30%
  // of the plan price (~95/250/600 typical chats). Enforced in
  // copilot.controller via SubscriptionService.checkCredits('ai_agent'),
  // measured from AiUsage (engine='agent').
  agent_tokens: number;
}
export interface PricingInterface {
  [key: string]: PricingInnerInterface;
}
// Per-tier platform entitlements. Each tier includes the one below it plus a
// few more. Starter carries the zero-marginal-cost platforms (Telegram/
// Bluesky/Mastodon are free APIs) plus the personal LinkedIn profile — its 3
// slots still cap usage. The upgrade levers: LinkedIn Pages (post as the
// company, not the person)/YouTube/Threads pull to Pro; X (our X API volume
// is capped) and Discord stay Business-only.
const STARTER_PROVIDERS = [
  'facebook',
  'instagram',
  'tiktok',
  'linkedin',
  'telegram',
  'bluesky',
  'mastodon',
];
const PRO_PROVIDERS = [
  ...STARTER_PROVIDERS,
  'threads',
  'youtube',
  'linkedin-page',
];
const BUSINESS_PROVIDERS = [...PRO_PROVIDERS, 'x', 'discord'];

export const pricing: PricingInterface = {
  FREE: {
    current: 'FREE',
    month_price: 0,
    year_price: 0,
    channel: 3,
    allowedProviders: STARTER_PROVIDERS,
    image_generation_count: 0,
    posts_per_month: 0,
    team_members: 1,
    community_features: false,
    featured_by_gitroom: false,
    ai: false,
    import_from_channels: false,
    image_generator: false,
    public_api: false,
    webhooks: 0,
    autoPost: false,
    autoPostLimit: 0,
    generate_videos: 0,
    agent_tokens: 0,
  },
  STANDARD: {
    current: 'STANDARD',
    month_price: 12,
    year_price: 120,
    channel: 3,
    allowedProviders: STARTER_PROVIDERS,
    posts_per_month: 400,
    image_generation_count: 30,
    team_members: 1,
    ai: true,
    community_features: false,
    featured_by_gitroom: false,
    import_from_channels: true,
    image_generator: true,
    public_api: true,
    webhooks: 2,
    autoPost: false,
    autoPostLimit: 0,
    generate_videos: 0,
    agent_tokens: 1_500_000,
  },
  // Legacy, not purchasable (removed from BillingSubscribeDto). Kept so any
  // existing/grandfathered TEAM subscription still resolves.
  TEAM: {
    current: 'TEAM',
    month_price: 39,
    year_price: 374,
    channel: 10,
    allowedProviders: BUSINESS_PROVIDERS,
    posts_per_month: 1000000,
    image_generation_count: 100,
    community_features: true,
    team_members: 1000000,
    featured_by_gitroom: true,
    ai: true,
    import_from_channels: true,
    image_generator: true,
    public_api: true,
    webhooks: 10,
    autoPost: true,
    autoPostLimit: 5,
    generate_videos: 10,
    agent_tokens: 4_000_000,
  },
  PRO: {
    current: 'PRO',
    month_price: 29,
    year_price: 290,
    channel: 6,
    allowedProviders: PRO_PROVIDERS,
    posts_per_month: 1000000,
    image_generation_count: 150,
    community_features: true,
    team_members: 2,
    featured_by_gitroom: true,
    ai: true,
    import_from_channels: true,
    image_generator: true,
    public_api: true,
    webhooks: 30,
    autoPost: true,
    autoPostLimit: 3,
    generate_videos: 30,
    agent_tokens: 4_000_000,
  },
  ULTIMATE: {
    current: 'ULTIMATE',
    month_price: 79,
    year_price: 790,
    // Every provider in BUSINESS_PROVIDERS — keep in sync when enabling a
    // new channel globally (X added 2026-07, Discord added 2026-07).
    channel: 12,
    allowedProviders: BUSINESS_PROVIDERS,
    posts_per_month: 1000000,
    image_generation_count: 600,
    community_features: true,
    team_members: 5,
    featured_by_gitroom: true,
    ai: true,
    import_from_channels: true,
    image_generator: true,
    public_api: true,
    webhooks: 10000,
    autoPost: true,
    autoPostLimit: 10,
    generate_videos: 60,
    agent_tokens: 10_000_000,
  },
};

// User-facing plan labels. Internal enum keys stay (clean upstream sync); the UI
// only ever shows these names. STANDARD=Starter, PRO=Pro, ULTIMATE=Business, FREE=Trial.
export const planLabels: Record<string, string> = {
  FREE: 'Trial',
  STANDARD: 'Starter',
  PRO: 'Pro',
  ULTIMATE: 'Business',
  TEAM: 'Team',
};

export const planLabel = (tier?: string | null): string =>
  (tier && planLabels[tier]) || tier || '';

// A 7-day Stripe trial runs on the paid tier the user picked, but with only
// this many channel slots — the tier's full quota unlocks on conversion. The
// platform allowlist is intentionally NOT reduced, so e.g. a Pro trial can
// still evaluate LinkedIn/YouTube on one of its capped slots.
export const TRIAL_CHANNEL_CAP = 3;

export const channelLimitFor = (org?: {
  isTrailing?: boolean;
  subscription?: { totalChannels: number } | null;
}): number => {
  const base = org?.subscription?.totalChannels || pricing.FREE.channel || 0;
  return org?.isTrailing ? Math.min(base, TRIAL_CHANNEL_CAP) : base;
};

/**
 * The tiers an admin may put an organization on without a payment.
 *
 * `pricing` also holds FREE, but FREE is not a `SubscriptionTier` in the
 * database — Prisma rejects the value, and the only route to FREE is deleting
 * the subscription row. Anything outside this list reaching the comp path used
 * to be a 500, or, for `__proto__`, a quiet 200 (E2E-09-40).
 *
 * TEAM is left out for the same reason it is not purchasable: it is a hidden
 * legacy plan that undercuts Business, and "give them everything" is what
 * ULTIMATE is for.
 */
export const COMPABLE_TIERS = ['STANDARD', 'PRO', 'ULTIMATE'] as const;

export type CompableTier = (typeof COMPABLE_TIERS)[number];

export const isCompableTier = (value: unknown): value is CompableTier =>
  typeof value === 'string' &&
  (COMPABLE_TIERS as readonly string[]).includes(value) &&
  Object.prototype.hasOwnProperty.call(pricing, value);
