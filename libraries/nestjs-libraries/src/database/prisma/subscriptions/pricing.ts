import dayjs from 'dayjs';

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
  // integration.manager `enabledProviders` to appear in the picker — e.g.
  // `linkedin-page` is listed for PRO here but shows "Coming soon" until it is
  // enabled globally.
  allowedProviders: string[];
  posts_per_month: number;
  // Team seat allowance INCLUDING the owner. 1 = solo (owner only, cannot
  // invite). Enforced at invite (permissions.service TEAM_MEMBERS) and
  // reconciled on tier change (subscription.service → reconcileTeamSeats).
  team_members: number;
  ai: boolean;
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
  // The assistant (chat and MCP ask_postra) has no visible limit: a monthly
  // fair use of questions per organisation stops a bot or a script, not a
  // person (~100 per working day). On gpt-5.6-luna a typical question costs
  // ~$0.0025, the whole allowance ~$5.50 (Plan/lunchdayfinal.md, "💷
  // Analiza", K. 2026-10-08). Enforced in copilot.controller and start.mcp
  // via SubscriptionService.checkCredits('ai_agent'), counted from AiUsage
  // (engine 'agent', unit 'messages').
  agent_messages: number;
}
export interface PricingInterface {
  [key: string]: PricingInnerInterface;
}
// Per-tier platform entitlements. Each tier includes the one below it plus a
// few more. Starter is the four platforms a small UK business actually runs on
// (the personal LinkedIn profile included, because freelancers and B2B sellers
// live there); its 3 slots still cap usage. Pro adds video and text-first
// platforms and LinkedIn Pages (post as the company); X (our X API volume is
// capped) and Discord stay Business-only, so Business is every platform.
const STARTER_PROVIDERS = ['facebook', 'instagram', 'tiktok', 'linkedin'];
const PRO_PROVIDERS = [
  ...STARTER_PROVIDERS,
  'youtube',
  'threads',
  'linkedin-page',
  'bluesky',
  'mastodon',
  'telegram',
];
const BUSINESS_PROVIDERS = [...PRO_PROVIDERS, 'x', 'discord'];

// Assistant questions a month, every paid plan (see agent_messages).
export const AGENT_FAIR_USE_MESSAGES = 2200;

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
    ai: false,
    image_generator: false,
    public_api: false,
    webhooks: 0,
    autoPost: false,
    autoPostLimit: 0,
    generate_videos: 0,
    agent_messages: 0,
  },
  // £19 from 2026-10-08 (was £12; K.): with 75 AI images, 15 AI videos and
  // 2 Auto Post feeds. Stripe prices are found or made by amount
  // (stripe.service), so a running £12 subscription keeps its price.
  STANDARD: {
    current: 'STANDARD',
    month_price: 19,
    year_price: 190,
    channel: 3,
    allowedProviders: STARTER_PROVIDERS,
    posts_per_month: 400,
    image_generation_count: 75,
    team_members: 1,
    ai: true,
    image_generator: true,
    public_api: true,
    webhooks: 2,
    autoPost: true,
    autoPostLimit: 2,
    generate_videos: 15,
    agent_messages: AGENT_FAIR_USE_MESSAGES,
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
    team_members: 1000000,
    ai: true,
    image_generator: true,
    public_api: true,
    webhooks: 10,
    autoPost: true,
    autoPostLimit: 5,
    generate_videos: 10,
    agent_messages: AGENT_FAIR_USE_MESSAGES,
  },
  PRO: {
    current: 'PRO',
    month_price: 29,
    year_price: 290,
    channel: 6,
    allowedProviders: PRO_PROVIDERS,
    posts_per_month: 1000000,
    image_generation_count: 200,
    team_members: 2,
    ai: true,
    image_generator: true,
    public_api: true,
    webhooks: 30,
    autoPost: true,
    autoPostLimit: 3,
    generate_videos: 30,
    agent_messages: AGENT_FAIR_USE_MESSAGES,
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
    team_members: 5,
    ai: true,
    image_generator: true,
    public_api: true,
    webhooks: 10000,
    autoPost: true,
    autoPostLimit: 10,
    generate_videos: 60,
    agent_messages: AGENT_FAIR_USE_MESSAGES,
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

// The monthly post allowance resets on the subscription's anniversary day
// (or the org's, without one). Shared by the API policy and the agent tool.
export const postsCycleStart = (anchor: Date | string): Date => {
  const months = Math.abs(dayjs(anchor).diff(dayjs(), 'month'));
  return dayjs(anchor).add(months, 'month').toDate();
};

// The billing month that holds `at` (now by default), as [start, end). Posts
// count against the month they are published in: counting from the cycle's
// start with no end let posts scheduled for later months eat this month's
// allowance (E2E-07-34).
export const postsCycleWindow = (
  anchor: Date | string,
  at: Date | string = new Date()
) => {
  // Both ends from the subscription date: adding a month to a start already
  // clipped at month end (31 Jan -> 28 Feb -> 28 Mar) left days in no month.
  // An invalid date, or one so far out that a month after it is not a date
  // any more, kept the loops going forever and froze the process (Codex):
  // such a date counts as now, and the corrections are bounded (diff is off
  // by one month at most).
  const sane = (d: dayjs.Dayjs) =>
    d.isValid() && Math.abs(d.year() - dayjs().year()) <= 100;
  const from = sane(dayjs(anchor)) ? dayjs(anchor) : dayjs();
  const when = sane(dayjs(at)) ? dayjs(at) : dayjs();
  let months = when.diff(from, 'month');
  for (let i = 0; i < 3 && from.add(months, 'month').isAfter(when); i++) {
    months--;
  }
  for (let i = 0; i < 3 && !from.add(months + 1, 'month').isAfter(when); i++) {
    months++;
  }
  return {
    start: from.add(months, 'month').toDate(),
    end: from.add(months + 1, 'month').toDate(),
  };
};

// A trial shows AI video with one clip (~$0.33 at kie.ai), whatever the plan
// (K. 2026-10-08).
export const TRIAL_VIDEO_CLIPS = 1;

// AI allowances follow the same rule as channels: a trial runs on Starter's
// pool, so a Business trial cannot burn 600 images before the first charge.
// Video is the exception: one clip.
export const trialAiAllowance = (
  allowance: number,
  isTrailing: boolean | undefined,
  type: 'image_generation_count' | 'agent_messages' | 'generate_videos'
): number => {
  if (!isTrailing) {
    return allowance;
  }
  const cap =
    type === 'generate_videos'
      ? TRIAL_VIDEO_CLIPS
      : pricing.STANDARD[type] || 0;
  return Math.min(allowance, cap);
};

/**
 * Channels that take a slot: every channel that is not disabled — including
 * one waiting to be reconnected, which comes back without asking for a slot.
 * Disabling is how a downgrade frees slots. One rule for every entry point
 * (connect, invite link, re-enable); they used to count three different ways.
 */
export const channelsInUse = (channels: { disabled?: boolean | null }[]): number =>
  channels.filter((c) => !c.disabled).length;

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
 * to be a 500, or, for `__proto__`, a quiet 200.
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
