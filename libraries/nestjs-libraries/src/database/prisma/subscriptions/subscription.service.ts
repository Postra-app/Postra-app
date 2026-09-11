import { HttpException, Injectable } from '@nestjs/common';
import {
  COMPABLE_TIERS,
  isCompableTier,
  pricing,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai-usage.service';
import { bustAuthContextCacheForUsers } from '@gitroom/nestjs-libraries/redis/auth-context.cache';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly _subscriptionRepository: SubscriptionRepository,
    private readonly _integrationService: IntegrationService,
    private readonly _organizationService: OrganizationService,
    private readonly _auditService: AuditService,
    private readonly _aiUsageService: AiUsageService
  ) {}

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscriptionRepository.getSubscriptionByOrganizationId(
      organizationId
    );
  }

  // For background flows (autopost, generate-posts) that only hold an orgId:
  // loads the subscription so credit enforcement sees the real tier.
  async useCreditByOrgId<T>(
    orgId: string,
    type: string,
    func: () => Promise<T>
  ): Promise<T> {
    const subscription =
      await this._subscriptionRepository.getSubscriptionByOrgId(orgId);
    return this.useCredit({ id: orgId, subscription } as any, type, func);
  }

  useCredit<T>(
    organization: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ): Promise<T> {
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
    let date = dayjs(organization.subscription.createdAt);
    while (date.isBefore(dayjs())) {
      date = date.add(1, 'month');
    }
    const cycleStart = date.subtract(1, 'month');
    const limit =
      checkType === 'ai_images'
        ? pricing[tier as keyof typeof pricing].image_generation_count
        : pricing[tier as keyof typeof pricing].generate_videos;
    return { limit: limit || 0, cycleStart: cycleStart.toDate() };
  }

  getCode(code: string) {
    return this._subscriptionRepository.getCode(code);
  }

  async deleteSubscription(customerId: string) {
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
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE'
  ) {
    if (!organizationId) {
      return false;
    }

    const getCurrentSubscription =
      (await this._subscriptionRepository.getSubscriptionByOrgId(
        organizationId
      ))!;

    const to = pricing[billing];

    const currentTotalChannels = (
      await this._integrationService.getIntegrationsList(organizationId)
    ).filter((f) => !f.disabled);

    if (currentTotalChannels.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        organizationId,
        currentTotalChannels.length - totalChannels
      );
    }

    // Reconcile active team seats to the new tier (owner + earliest-joined
    // members up to the cap stay; overflow is disabled on downgrade and
    // re-enabled within the cap on upgrade).
    await this._organizationService.reconcileTeamSeats(
      organizationId,
      to.team_members
    );

    if (billing === 'FREE') {
      await this._integrationService.changeActiveCron(organizationId);
    }

    return true;
  }

  async modifySubscription(
    customerId: string,
    totalChannels: number,
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE'
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

    const to = pricing[billing];

    const currentTotalChannels = (
      await this._integrationService.getIntegrationsList(
        getOrgByCustomerId?.id!
      )
    ).filter((f) => !f.disabled);

    // Platform gating: disable any active channel whose platform is not allowed
    // on the new tier (e.g. downgrading Business→Pro drops X / Mastodon /
    // Bluesky / Telegram). Do this before the count cap so the remaining set is
    // the keepers.
    const disallowedByPlatform = currentTotalChannels.filter(
      (c) => !to.allowedProviders.includes(c.providerIdentifier)
    );
    for (const channel of disallowedByPlatform) {
      await this._integrationService.disableChannel(
        getOrgByCustomerId?.id!,
        channel.id
      );
    }

    const remainingChannels = currentTotalChannels.filter((c) =>
      to.allowedProviders.includes(c.providerIdentifier)
    );
    if (remainingChannels.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        getOrgByCustomerId?.id!,
        remainingChannels.length - totalChannels
      );
    }

    // Reconcile active team seats to the new tier (owner + earliest-joined
    // members up to the cap stay; overflow is disabled on downgrade and
    // re-enabled within the cap on upgrade).
    await this._organizationService.reconcileTeamSeats(
      getOrgByCustomerId?.id!,
      to.team_members
    );

    if (billing === 'FREE') {
      await this._integrationService.changeActiveCron(getOrgByCustomerId?.id!);
    }

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
    org?: string
  ) {
    if (!code) {
      try {
        // Addressed by org (an admin comp) rather than by Stripe customer:
        // modifySubscription resolves the org through paymentId and would bail
        // on an org that has never paid.
        const load =
          org && !customerId
            ? await this.modifySubscriptionByOrg(org, totalChannels, billing)
            : await this.modifySubscription(customerId, totalChannels, billing);
        if (!load) {
          return {};
        }
      } catch (e) {
        return {};
      }
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
        org ? { id: org } : undefined
      );
    await this.bustMembersAuthCache(org, customerId);
    return result;
  }

  /**
   * One-off pre-launch backfill. Turning on Stripe billing flips every org that
   * has no subscription down to FREE (2 channels) — this would strip access from
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

  async checkCredits(organization: Organization, checkType = 'ai_images') {
    // @ts-ignore
    const type = organization?.subscription?.subscriptionTier || 'FREE';

    if (type === 'FREE') {
      return { credits: 0 };
    }

    // @ts-ignore
    let date = dayjs(organization.subscription.createdAt);
    while (date.isBefore(dayjs())) {
      date = date.add(1, 'month');
    }

    const checkFromMonth = date.subtract(1, 'month');
    const allowance =
      checkType === 'ai_images'
        ? pricing[type].image_generation_count
        : checkType === 'ai_agent'
        ? pricing[type].agent_tokens
        : pricing[type].generate_videos;

    // Agent chat is measured from AiUsage (weighted tokens written by the
    // metering wrapper), not the Credits ledger the image/video paths use.
    const totalUse =
      checkType === 'ai_agent'
        ? await this._aiUsageService.weightedAgentUsageSince(
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
   * cause of the "No such customer" class (E2E-09-09). Nothing writes
   * paymentId here any more.
   */
  async addSubscription(
    orgId: string,
    userId: string,
    subscription: string
  ): Promise<any> {
    // Validate before the first write. The tier used to be an unvalidated
    // string indexed straight into `pricing`: an unknown key threw a 500 and
    // `__proto__` resolved to Object.prototype and returned a quiet 200 — both
    // of them *after* the destructive write above (E2E-09-40).
    if (!isCompableTier(subscription)) {
      throw new HttpException(
        `Unknown subscription tier "${subscription}". Expected one of ${COMPABLE_TIERS.join(
          ', '
        )}.`,
        400
      );
    }

    // An org that pays through Stripe must be changed in Stripe. Comping it
    // here would leave the two disagreeing, and the next webhook would
    // overwrite whatever we wrote.
    const paymentId = await this._subscriptionRepository.getPaymentId(orgId);
    if (paymentId?.startsWith('cus_')) {
      throw new HttpException(
        'This organization has a live Stripe customer — change the plan in Stripe instead.',
        400
      );
    }

    this._auditService.record({
      action: 'subscription.comp',
      organizationId: orgId,
      userId,
      metadata: { tier: subscription },
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
      orgId
    );
  }
}
