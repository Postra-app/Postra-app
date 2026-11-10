import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  COMPABLE_TIERS,
  COMP_MONTHS,
  COMP_REASONS,
  isCompMonths,
  isCompReason,
  channelLimitFor,
  isCompableTier,
  postAllowance,
  pricing,
  trialAiAllowance,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { Organization } from '@prisma/client';
import { PostCap } from '@gitroom/nestjs-libraries/database/prisma/posts/post.cap';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai-usage.service';
import { bustAuthContextCacheForUsers } from '@gitroom/nestjs-libraries/redis/auth-context.cache';
import { aiCooldownMessage } from '@gitroom/nestjs-libraries/services/ai.cooldown';
import { normalizeEmail } from '@gitroom/helpers/utils/email.normalize';

// The start of the current monthly period, counted from the subscription's
// day of the month — the window AI credits are counted in.
// From Stripe's billing anchor when Stripe bills the plan, so the month runs
// with the invoices; from the subscription's creation otherwise.
const currentPeriodStart = (subscription: {
  createdAt: Date;
  periodAnchor?: Date | null;
}) => {
  // In UTC, as Stripe counts months: in the server's zone (Europe/London) a
  // month across a clock change moved the boundary by an hour.
  let date = dayjs.utc(subscription.periodAnchor || subscription.createdAt);
  while (date.isBefore(dayjs.utc())) {
    date = date.add(1, 'month');
  }
  return date.subtract(1, 'month');
};

// One "@", something before it, a dotted domain after it, no spaces, at
// most 254 characters. Checked without a regular expression: the pattern
// used before backtracked polynomially on crafted input.
export const isPlainEmail = (address: string) => {
  if (!address || address.length > 254 || /\s/.test(address)) return false;
  const at = address.indexOf('@');
  if (at <= 0 || at !== address.lastIndexOf('@')) return false;
  const domain = address.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
};

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly _subscriptionRepository: SubscriptionRepository,
    private readonly _integrationService: IntegrationService,
    private readonly _organizationService: OrganizationService,
    private readonly _auditService: AuditService,
    private readonly _aiUsageService: AiUsageService
  ) {}

  // Whether the organisation is in its trial, for flows that hold only its id
  // (TRIAL_LIMITS in pricing.ts apply).
  async isTrailing(orgId: string) {
    return !!(await this._organizationService.getOrgById(orgId))?.isTrailing;
  }

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscriptionRepository.getSubscriptionByOrganizationId(
      organizationId
    );
  }

  // For background flows (autopost, generate-posts) that only hold an orgId:
  // loads the subscription so credit enforcement sees the real tier.
  refundCredit(id: string) {
    return this._subscriptionRepository.refundCredit(id);
  }

  async useCreditByOrgId<T>(
    orgId: string,
    type: string,
    func: (reservation: { id: string }) => Promise<T>
  ): Promise<T> {
    const subscription =
      await this._subscriptionRepository.getSubscriptionByOrgId(orgId);
    // The trial flag too: without it a trial was held to the full plan pool.
    const organization = await this._organizationService.getOrgById(orgId);
    return this.useCredit(
      {
        id: orgId,
        subscription,
        isTrailing: !!organization?.isTrailing,
        createdAt: organization?.createdAt,
      } as any,
      type,
      func
    );
  }

  useCredit<T>(
    organization: Organization,
    type = 'ai_images',
    func: (reservation: { id: string }) => Promise<T>
  ): Promise<T> {
    // Every paid image and clip comes through here, whichever way it was
    // asked for, so the signup hour is held here too (ai.cooldown.ts).
    const paid =
      // @ts-ignore
      organization?.subscription &&
      // @ts-ignore
      !organization.subscription.deletedAt &&
      !organization.isTrailing;
    const refusal = paid ? null : aiCooldownMessage(organization?.createdAt);
    if (refusal) {
      return Promise.reject(new HttpException(refusal, 403));
    }
    return this._subscriptionRepository.useCredit(
      organization,
      type,
      func,
      this.getCreditEnforcement(organization, type)
    );
  }

  // Atomic counterpart of checkCredits (which stays advisory/UI-only): when
  // billing is on, useCredit re-verifies the cap inside the insert
  // transaction so parallel requests can't overshoot the plan limit.
  private getCreditEnforcement(
    organization: Organization,
    checkType: string
  ): { limit: number; cycleStart: Date } | undefined {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return undefined;
    }
    // @ts-ignore
    const tier = organization?.subscription?.subscriptionTier || 'FREE';
    if (tier === 'FREE') {
      return { limit: 0, cycleStart: new Date(0) };
    }
    // @ts-ignore
    const cycleStart = currentPeriodStart(organization.subscription);
    const field =
      checkType === 'ai_images' ? 'image_generation_count' : 'generate_videos';
    const limit = trialAiAllowance(
      pricing[tier as keyof typeof pricing][field] || 0,
      organization.isTrailing,
      field
    );
    return { limit, cycleStart: cycleStart.toDate() };
  }

  getCode(code: string) {
    return this._subscriptionRepository.getCode(code);
  }

  async deleteSubscription(customerId: string, forStripeUniqueId?: string) {
    // A Stripe event names the subscription it is about (metadata.uniqueId,
    // the plan row's identifier). The row is found by customer, so an event
    // for an old subscription that arrives after an administrator comped the
    // organization would otherwise end the comp.
    if (forStripeUniqueId) {
      const current =
        await this._subscriptionRepository.getSubscriptionByCustomerId(customerId);
      if (current?.identifier && current.identifier !== forStripeUniqueId) {
        return false;
      }
    }
    // modifySubscription returns false for lifetime/grandfathered grants (and
    // unknown customers). A stray customer.subscription.deleted webhook or the
    // superadmin cancel path must NOT then hard-delete the lifetime row and drop
    // the org to FREE — bail if the downgrade was refused.
    const modified = await this.modifySubscription(
      customerId,
      pricing.FREE.channel || 0,
      'FREE'
    );
    if (!modified) {
      return false;
    }
    this._auditService.record({
      action: 'subscription.delete',
      metadata: { customerId },
    });
    const deleted =
      await this._subscriptionRepository.deleteSubscriptionByCustomerId(
        customerId
      );
    await this.bustMembersAuthCache(undefined, customerId);
    return deleted;
  }

  // A subscription written by a Stripe webhook must be visible to the very
  // next /user/self call: the frontend re-fetches the user exactly once, the
  // moment /billing/check turns positive. auth.middleware caches user+orgs in
  // Redis for 30s, and seat reconciliation only busts members whose disabled
  // flag flipped — a solo owner buying a plan flips nobody, so their cached
  // FREE context survived and the paywall stayed up after a successful payment.
  private async bustMembersAuthCache(orgId?: string, customerId?: string) {
    try {
      const id =
        orgId ||
        (customerId
          ? (await this._organizationService.getOrgByCustomerId(customerId))?.id
          : undefined);
      if (!id) {
        return;
      }
      const team = await this._organizationService.getTeam(id);
      await bustAuthContextCacheForUsers(
        (team?.users || []).map((u) => u.user.id)
      );
    } catch (e) {
      // Cache busting must never fail the subscription write; worst case the
      // stale context expires on its own within 30s.
    }
  }

  assignCustomerId(
    organizationId: string,
    expected: string | null,
    customerId: string
  ) {
    return this._subscriptionRepository.assignCustomerId(
      organizationId,
      expected,
      customerId
    );
  }

  getPaymentId(organizationId: string) {
    return this._subscriptionRepository.getPaymentId(organizationId);
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._subscriptionRepository.updateCustomerId(
      organizationId,
      customerId
    );
  }

  setCancelAt(organizationId: string, cancelAt: Date | null) {
    return this._subscriptionRepository.setCancelAt(organizationId, cancelAt);
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    return await this._subscriptionRepository.checkSubscription(
      organizationId,
      subscriptionId
    );
  }

  async modifySubscriptionByOrg(
    organizationId: string,
    totalChannels: number,
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    isTrailing = false
  ) {
    if (!organizationId) {
      return false;
    }

    const current = await this._subscriptionRepository.getSubscriptionByOrgId(
      organizationId
    );
    await this.applyTierLimits(organizationId, totalChannels, billing, {
      isTrailing,
      previousChannels: current?.totalChannels || 0,
    });
    return true;
  }

  // What a tier change does to an organisation, whichever way it arrives
  // (Stripe webhook by customer, admin comp or revoke by org): channels on
  // platforms the tier does not include are disabled first, then the rest is
  // capped, then team seats are reconciled. The by-org path used to skip the
  // platform step, so an admin moving Business -> Starter left X and Discord
  // running on Starter.
  private async applyTierLimits(
    organizationId: string,
    totalChannels: number,
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    change: { isTrailing: boolean; previousChannels: number } = {
      isTrailing: false,
      previousChannels: 0,
    }
  ) {
    const to = pricing[billing];

    const channels = await this._integrationService.getIntegrationsList(
      organizationId
    );
    const active = channels.filter((f) => !f.disabled);

    const disallowedByPlatform = active.filter(
      (c) => !to.allowedProviders.includes(c.providerIdentifier)
    );
    for (const channel of disallowedByPlatform) {
      await this._integrationService.disableChannel(organizationId, channel.id);
    }

    const remaining = active.filter((c) =>
      to.allowedProviders.includes(c.providerIdentifier)
    );
    if (remaining.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        organizationId,
        remaining.length - totalChannels
      );
    }

    // A lapsed trial or cancelled plan drops to FREE and disables channels;
    // paying again never switched them back on (upstream 4a6ba07f, c145f0c3).
    // Only when the limit grew, so a renewal or a cancel toggle does not undo
    // channels the user disabled on purpose, and only when every channel the
    // plan's platforms cover fits, since auto-disabled channels cannot be told
    // apart from the user's. Platforms outside the plan stay off.
    const limit = channelLimitFor({
      isTrailing: change.isTrailing,
      subscription: { totalChannels },
    });
    const toEnable = (list: typeof channels) => {
      const covered = list.filter((c) =>
        to.allowedProviders.includes(c.providerIdentifier)
      );
      return covered.length <= limit
        ? covered.filter((c) => c.disabled).map((c) => c.id)
        : [];
    };
    // Checked once on the list read above (most webhooks have nothing to
    // switch on and take no lock), decided again inside the lock.
    if (
      billing !== 'FREE' &&
      totalChannels > change.previousChannels &&
      toEnable(channels).length
    ) {
      await this._integrationService.enableChannelsUnderLock(
        organizationId,
        toEnable
      );
    }

    // Owner + earliest-joined members up to the cap stay; overflow is disabled
    // on downgrade and re-enabled within the cap on upgrade.
    await this._organizationService.reconcileTeamSeats(
      organizationId,
      to.team_members
    );

    // Every plan without Auto Post stops the feeds, not only FREE: a Pro org
    // moving to Starter kept generating and publishing. A plan with
    // fewer feeds keeps the oldest running ones. Webhooks over the
    // new limit are paused where they are delivered (WebhooksService).
    await this._integrationService.changeActiveCron(
      organizationId,
      to.autoPost ? to.autoPostLimit : 0
    );
  }

  async modifySubscription(
    customerId: string,
    totalChannels: number,
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    isTrailing = false
  ) {
    if (!customerId) {
      return false;
    }

    const getOrgByCustomerId =
      await this._subscriptionRepository.getOrganizationByCustomerId(
        customerId
      );

    const getCurrentSubscription =
      (await this._subscriptionRepository.getSubscriptionByCustomerId(
        customerId
      ))!;

    if (
      !getOrgByCustomerId ||
      (getCurrentSubscription && getCurrentSubscription?.isLifetime)
    ) {
      return false;
    }

    await this.applyTierLimits(getOrgByCustomerId.id, totalChannels, billing, {
      isTrailing,
      previousChannels: getCurrentSubscription?.totalChannels || 0,
    });

    return true;
  }

  async createOrUpdateSubscription(
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code?: string,
    org?: string,
    // Stripe's billing_cycle_anchor (webhooks only).
    periodAnchor?: Date,
    // An admin comp's reason and end date; every other write clears them.
    comp?: { reason: string; endsAt: Date | null }
  ) {
    if (!code) {
      // Addressed by org (an admin comp) rather than by Stripe customer:
      // modifySubscription resolves the org through paymentId and would bail
      // on an org that has never paid. `false` means "not ours to write"
      // (unknown customer, lifetime plan); a thrown error must reach the
      // webhook so Stripe retries instead of the plan being silently lost.
      const load =
        org && !customerId
          ? await this.modifySubscriptionByOrg(
              org,
              totalChannels,
              billing,
              isTrailing
            )
          : await this.modifySubscription(
              customerId,
              totalChannels,
              billing,
              isTrailing
            );
      if (!load) {
        return {};
      }
    } else if (org) {
      // A lifetime grant to an organisation: the plan's limits apply as for a
      // comp. Skipped, channels a revoke had switched off stayed off under
      // the new 100-channel plan.
      await this.modifySubscriptionByOrg(org, totalChannels, billing, isTrailing);
    }
    this._auditService.record({
      action: 'subscription.change',
      organizationId: org,
      metadata: { customerId, billing, period, totalChannels, isTrailing },
    });
    const result =
      await this._subscriptionRepository.createOrUpdateSubscription(
        isTrailing,
        identifier,
        customerId,
        totalChannels,
        billing,
        period,
        cancelAt,
        code,
        org ? { id: org } : undefined,
        periodAnchor,
        comp
      );
    await this.bustMembersAuthCache(org, customerId);
    return result;
  }

  /**
   * One-off pre-launch backfill. Turning on Stripe billing flips every org that
   * has no subscription down to FREE (3 channels) — this would strip access from
   * the founder and existing users. This grants each such org a lifetime top-tier
   * (Business/ULTIMATE) subscription instead. Passing a `code` marks it
   * isLifetime and bypasses Stripe entirely (no customer/charge). Idempotent:
   * orgs that already hold an active subscription are left untouched.
   */
  async grandfatherAllOrganizations(apply: boolean) {
    const TIER = 'ULTIMATE' as const;
    const MIN_CHANNELS = 100; // generous ceiling so a comped account never hits a cap
    const orgs =
      await this._subscriptionRepository.getAllOrganizationsForGrandfather();

    const granted: Array<{ id: string; name: string; channels: number }> = [];
    const skipped: Array<{ id: string; name: string; reason: string }> = [];

    for (const org of orgs) {
      const sub = org.subscription;
      if (sub && !sub.deletedAt) {
        skipped.push({
          id: org.id,
          name: org.name,
          reason: `already ${sub.isLifetime ? 'lifetime' : 'active'} ${
            sub.subscriptionTier
          }`,
        });
        continue;
      }

      const channels = Math.max(MIN_CHANNELS, org.Integration.length);
      granted.push({ id: org.id, name: org.name, channels });

      if (apply) {
        await this.createOrUpdateSubscription(
          false, // isTrailing
          makeId(10), // identifier
          '', // customerId (unused when org id + code are provided)
          channels,
          TIER,
          'MONTHLY',
          null,
          `grandfather-${org.id}`, // code -> isLifetime=true, skips Stripe
          org.id
        );
      }
    }

    return { total: orgs.length, granted, skipped };
  }

  /**
   * Targeted version of the grandfather backfill: grants a lifetime Business
   * subscription to every org OWNED (SUPERADMIN) by `email`. Used to comp
   * tester / influencer accounts so they skip the paywall and the trial-only
   * anti-abuse guards (e.g. the "previously connected" channel block).
   * Idempotent — an org that already holds an active subscription is skipped.
   */
  async grantLifetimeByEmail(email: string, apply: boolean) {
    const TIER = 'ULTIMATE' as const;
    const MIN_CHANNELS = 100;
    const orgs =
      await this._subscriptionRepository.getOwnedOrganizationsByEmail(
        email.trim()
      );

    const granted: Array<{ id: string; name: string; channels: number }> = [];
    const skipped: Array<{ id: string; name: string; reason: string }> = [];

    for (const org of orgs) {
      const sub = org.subscription;
      if (sub && !sub.deletedAt) {
        skipped.push({
          id: org.id,
          name: org.name,
          reason: `already ${sub.isLifetime ? 'lifetime' : 'active'} ${
            sub.subscriptionTier
          }`,
        });
        continue;
      }

      const channels = Math.max(MIN_CHANNELS, org.Integration.length);
      granted.push({ id: org.id, name: org.name, channels });

      if (apply) {
        await this.createOrUpdateSubscription(
          false, // isTrailing
          makeId(10), // identifier
          '', // customerId (unused when org id + code are provided)
          channels,
          TIER,
          'MONTHLY',
          null,
          `grandfather-${org.id}`, // code -> isLifetime=true, skips Stripe
          org.id
        );
      }
    }

    return { email: email.trim(), total: orgs.length, granted, skipped };
  }

  // Active subscriptions persist their channel quota (totalChannels), so
  // raising pricing[tier].channel only affects NEW checkouts. This brings
  // existing rows up to the current quota after a channel launch. Never
  // lowers (grandfathered quotas stay) and skips lifetime rows (they carry
  // their own, higher allowance).
  async syncChannelSlots(apply: boolean) {
    const subs = await this._subscriptionRepository.listActiveNonLifetime();

    const updated: Array<{
      org: string;
      tier: string;
      from: number;
      to: number;
    }> = [];
    const skipped: Array<{ org: string; tier: string; channels: number }> = [];

    for (const sub of subs) {
      const expected =
        pricing[sub.subscriptionTier as keyof typeof pricing]?.channel || 0;
      if (expected > sub.totalChannels) {
        updated.push({
          org: sub.organization.name,
          tier: sub.subscriptionTier,
          from: sub.totalChannels,
          to: expected,
        });
        if (apply) {
          await this._subscriptionRepository.updateTotalChannels(
            sub.id,
            expected
          );
        }
      } else {
        skipped.push({
          org: sub.organization.name,
          tier: sub.subscriptionTier,
          channels: sub.totalChannels,
        });
      }
    }

    return { total: subs.length, updated, skipped };
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscriptionRepository.getSubscriptionByIdentifier(identifier);
  }

  async getSubscription(organizationId: string) {
    return this._subscriptionRepository.getSubscription(organizationId);
  }

  // The monthly post allowance for flows that hold only the organisation id
  // (the agent, Auto Post); none while billing is off.
  async postCap(
    orgId: string,
    orgCreatedAt: Date | string
  ): Promise<PostCap | undefined> {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return undefined;
    }
    return postAllowance(
      await this.getSubscription(orgId),
      orgCreatedAt,
      await this.isTrailing(orgId)
    );
  }

  // Gives an organization this billing period's AI images or videos back
  // (support, from /admin). Older periods stay, so usage history is kept;
  // the assistant is counted from AiUsage and is not reset here.
  async resetCredits(organizationId: string, type: 'ai_images' | 'ai_videos') {
    const subscription = await this._subscriptionRepository.getSubscription(
      organizationId
    );
    if (!subscription) {
      return null;
    }
    const { count } = await this._subscriptionRepository.deleteCreditsFrom(
      organizationId,
      currentPeriodStart(subscription),
      type
    );
    return { deleted: count };
  }

  async checkCredits(organization: Organization, checkType = 'ai_images') {
    // @ts-ignore
    const type = organization?.subscription?.subscriptionTier || 'FREE';

    if (type === 'FREE') {
      return { credits: 0 };
    }

    const checkFromMonth = currentPeriodStart(
      // @ts-ignore
      organization.subscription
    );
    const field =
      checkType === 'ai_images'
        ? 'image_generation_count'
        : checkType === 'ai_agent'
        ? 'agent_messages'
        : 'generate_videos';
    const allowance = trialAiAllowance(
      pricing[type][field] || 0,
      organization.isTrailing,
      field
    );

    // The assistant is measured from AiUsage (one row per question), not
    // the Credits ledger the image/video paths use.
    const totalUse =
      checkType === 'ai_agent'
        ? await this._aiUsageService.agentMessagesSince(
            organization.id,
            checkFromMonth.toDate()
          )
        : await this._subscriptionRepository.getCreditsFrom(
            organization.id,
            checkFromMonth,
            checkType
          );

    return {
      credits: allowance - totalUse,
    };
  }

  /**
   * Put an organization on a paid tier without a payment — a test account, a
   * compensation, an account we owe a plan to.
   *
   * This used to open with `setCustomerId(orgId, userId)`, which wrote the
   * *user's* id into `organization.paymentId`. That column is the org's only
   * handle on Stripe, so one call replaced a live `cus_…` with a value Stripe
   * has never heard of, and every later webhook for that org — renewal, failed
   * payment, cancellation — silently matched no organization. It was the root
   * cause of the "No such customer" class. Nothing writes
   * paymentId here any more.
   */
  /**
   * Take back a comp or a lifetime grant. Stripe is not involved: an org that
   * pays is refused, because it must be changed where it is billed.
   */
  async revokeSubscription(
    orgId: string,
    actorUserId: string,
    // As in addSubscription: a comp can sit on an organization whose Stripe
    // customer never subscribed, and has to come off it the same way.
    stripeSubscriptionOpen?: (customerId: string) => Promise<boolean>
  ) {
    const paymentId = await this._subscriptionRepository.getPaymentId(orgId);
    if (
      paymentId?.startsWith('cus_') &&
      (!stripeSubscriptionOpen || (await stripeSubscriptionOpen(paymentId)))
    ) {
      throw new HttpException(
        'This organization has a Stripe subscription - cancel it in Stripe instead.',
        400
      );
    }

    const result = await this._subscriptionRepository.softDeleteSubscriptionByOrg(
      orgId
    );

    if (result.revoked) {
      await this.backToFree(orgId, 'subscription.revoke', actorUserId);
    }

    return result;
  }

  // Back to the free tier: channels over the cap are disabled and team seats
  // reconciled, exactly as a downgrade does.
  private async backToFree(
    orgId: string,
    action: 'subscription.revoke' | 'subscription.comp.expired',
    actorUserId?: string
  ) {
    await this.modifySubscriptionByOrg(orgId, pricing.FREE.channel || 0, 'FREE');
    await this.bustMembersAuthCache(orgId, undefined);
    this._auditService.record({
      action,
      organizationId: orgId,
      userId: actorUserId,
    });
  }

  async addSubscription(
    orgId: string,
    userId: string,
    subscription: string,
    // Asks Stripe whether the customer has a subscription that can still
    // bill or change state. Without it every cus_ counts as paying.
    stripeSubscriptionOpen?: (customerId: string) => Promise<boolean>,
    // How long and why. No months = until revoked; no reason = 'compensation'
    // (what every comp was before reasons were kept).
    terms: { months?: number | null; reason?: string | null } = {}
  ): Promise<any> {
    // Validate before the first write. The tier used to be an unvalidated
    // string indexed straight into `pricing`: an unknown key threw a 500 and
    // `__proto__` resolved to Object.prototype and returned a quiet 200 — both
    // of them *after* the destructive write above.
    if (!isCompableTier(subscription)) {
      throw new HttpException(
        `Unknown subscription tier "${subscription}". Expected one of ${COMPABLE_TIERS.join(
          ', '
        )}.`,
        400
      );
    }
    const months = terms.months ?? null;
    if (months !== null && !isCompMonths(months)) {
      throw new HttpException(
        `A comp lasts ${COMP_MONTHS.join(', ')} months, or until revoked.`,
        400
      );
    }
    const reason = terms.reason ?? 'compensation';
    if (!isCompReason(reason)) {
      throw new HttpException(
        `Unknown reason "${reason}". Expected one of ${COMP_REASONS.join(', ')}.`,
        400
      );
    }
    const endsAt = months ? dayjs().add(months, 'month').toDate() : null;

    // An org that pays through Stripe must be changed in Stripe. Comping it
    // here would leave the two disagreeing, and the next webhook would
    // overwrite whatever we wrote. A customer alone is not paying: the plan
    // page creates one for every new account the moment it opens, so the
    // refusal is for a subscription Stripe can still bill or change.
    const paymentId = await this._subscriptionRepository.getPaymentId(orgId);
    const stripeCustomer = !!paymentId?.startsWith('cus_');
    if (
      stripeCustomer &&
      (!stripeSubscriptionOpen || (await stripeSubscriptionOpen(paymentId!)))
    ) {
      throw new HttpException(
        'This organization has a Stripe subscription - change the plan in Stripe instead.',
        400
      );
    }

    this._auditService.record({
      action: 'subscription.comp',
      organizationId: orgId,
      userId,
      metadata: {
        tier: subscription,
        reason,
        endsAt: endsAt?.toISOString() ?? null,
        ...(stripeCustomer ? { stripeCustomerWithoutSubscription: true } : {}),
      },
    });

    return this.createOrUpdateSubscription(
      false,
      makeId(5),
      '', // no Stripe customer: this grant is addressed by org id
      pricing[subscription].channel!,
      subscription,
      'MONTHLY',
      null,
      undefined,
      orgId,
      undefined,
      { reason, endsAt }
    );
  }

  /**
   * Take back every comp whose end date has passed — the organization goes
   * back to FREE exactly as a revoke from the panel does. Run daily by
   * housekeeping. A Stripe write clears the end date, so a row that still
   * carries one was last written by a comp and is not billed by Stripe.
   */
  async expireComps(now = new Date()) {
    const due = await this._subscriptionRepository.listExpiredComps(now);
    const expired: typeof due = [];
    for (const row of due) {
      // The end date is checked again in the write itself: a comp extended,
      // or a plan bought (which clears compEndsAt), between the list and
      // this point must not be taken away.
      const { revoked } = await this._subscriptionRepository.softDeleteExpiredComp(
        row.organizationId,
        now
      );
      if (!revoked) continue;
      await this.backToFree(row.organizationId, 'subscription.comp.expired');
      expired.push(row);
    }
    return expired;
  }

  listComps() {
    return this._subscriptionRepository.listComps();
  }

  listPendingGrants() {
    return this._subscriptionRepository.listPendingGrants();
  }

  /**
   * Promise a comp to an email address whose account does not exist yet. The
   * organization created at sign-up gets it at once (applyPendingGrant), so
   * the person never meets the plan page. An address that already has an
   * account is refused: comp its organization instead.
   */
  async createPendingGrant(
    email: string,
    tier: string,
    terms: { months?: number | null; reason?: string | null },
    actorUserId: string
  ) {
    // Raw request body: a number or an object here must be a 400, not a 500.
    const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!isPlainEmail(address)) {
      throw new HttpException('A valid email address is required', 400);
    }
    if (!isCompableTier(tier)) {
      throw new HttpException(
        `Unknown subscription tier "${tier}". Expected one of ${COMPABLE_TIERS.join(', ')}.`,
        400
      );
    }
    const months = terms.months ?? null;
    if (months !== null && !isCompMonths(months)) {
      throw new HttpException(
        `A comp lasts ${COMP_MONTHS.join(', ')} months, or until revoked.`,
        400
      );
    }
    const reason = terms.reason ?? 'influencer';
    if (!isCompReason(reason)) {
      throw new HttpException(
        `Unknown reason "${reason}". Expected one of ${COMP_REASONS.join(', ')}.`,
        400
      );
    }
    if (await this._subscriptionRepository.userExistsByEmail(address)) {
      throw new HttpException(
        'This email already has an account - comp its organization in Users.',
        409
      );
    }
    // One promise per address: a new one replaces the one still waiting.
    await this._subscriptionRepository.deleteOpenPendingGrantsByEmail(address);
    const grant = await this._subscriptionRepository.createPendingGrant({
      email: address,
      tier,
      months,
      reason,
      createdById: actorUserId,
    });
    this._auditService.record({
      action: 'subscription.pending-grant',
      userId: actorUserId,
      metadata: { grantId: grant.id, tier, months, reason },
    });
    return grant;
  }

  async deletePendingGrant(id: string) {
    const { count } = await this._subscriptionRepository.deleteOpenPendingGrant(id);
    return { deleted: count > 0 };
  }

  /**
   * Called when sign-up creates an organization: a comp promised to this
   * address is put on it now. Never throws — a failed grant must not fail the
   * sign-up; the admin can still comp the organization by hand.
   */
  // The promise as typed, or the same Gmail mailbox written with other dots
  // (sign-up treats those as one address, so the person cannot have both).
  // Not across a +tag: on most domains that is a different mailbox, and a
  // sign-up there must not use up someone else's promise.
  private async findPendingGrantFor(address: string) {
    const exact = await this._subscriptionRepository.findOpenPendingGrant(address);
    if (exact || address.split('@')[0].includes('+')) return exact;
    const wanted = normalizeEmail(address);
    const open = await this._subscriptionRepository.listOpenPendingGrants();
    return (
      open.find(
        (g) => !g.email.split('@')[0].includes('+') && normalizeEmail(g.email) === wanted
      ) ?? null
    );
  }

  async applyPendingGrant(organizationId: string, email?: string | null) {
    const address = (email || '').trim().toLowerCase();
    if (!address) return false;
    try {
      const grant = await this.findPendingGrantFor(address);
      if (!grant) return false;
      if (!(await this._subscriptionRepository.consumePendingGrant(grant.id, organizationId))) {
        return false;
      }
      try {
        await this.addSubscription(organizationId, grant.createdById, grant.tier, undefined, {
          months: grant.months,
          reason: grant.reason,
        });
      } catch (err) {
        // No plan, so no "applied": the promise goes back to waiting and the
        // panel shows it, instead of a grant used up for nothing.
        await this._subscriptionRepository.releasePendingGrant(grant.id, organizationId);
        throw err;
      }
      this._auditService.record({
        action: 'subscription.pending-grant.applied',
        organizationId,
        userId: grant.createdById,
        metadata: { grantId: grant.id, tier: grant.tier, months: grant.months, reason: grant.reason },
      });
      return true;
    } catch (err) {
      new Logger(SubscriptionService.name).error(
        `[pending-grant] not applied to ${organizationId}: ${(err as Error)?.message}`
      );
      return false;
    }
  }
}
