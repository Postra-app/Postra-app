import { Ability, AbilityBuilder, AbilityClass } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import {
  postsCycleStart,
  pricing,
  TRIAL_CHANNEL_CAP,
  channelsInUse,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthorizationActions, Sections } from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

export type AppAbility = Ability<[AuthorizationActions, Sections]>;

@Injectable()
export class PermissionsService {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _webhooksService: WebhooksService,
    private _autopostService: AutopostService,
    private _organizationService: OrganizationService
  ) {}
  async getPackageOptions(orgId: string) {
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(orgId);

    const tier =
      subscription?.subscriptionTier ||
      // billing off => everyone is ULTIMATE (users.controller reports the
      // same); the check() short-circuit usually fires first, this aligns
      // getPackageOptions for the rare direct callers
      (!process.env.STRIPE_PUBLISHABLE_KEY ? 'ULTIMATE' : 'FREE');

    const { channel, ...all } = pricing[tier];
    return {
      subscription,
      options: {
        ...all,
        ...{ channel: tier === 'FREE' ? channel : -10 },
      },
    };
  }

  async check(
    orgId: string,
    created_at: Date,
    permission: 'USER' | 'ADMIN' | 'SUPERADMIN',
    requestedPermission: Array<[AuthorizationActions, Sections]>,
    refreshChannelId?: string,
    isTrailing = false,
    isDraft = false
  ) {
    const { can, build } = new AbilityBuilder<
      Ability<[AuthorizationActions, Sections]>
    >(Ability as AbilityClass<AppAbility>);

    if (
      requestedPermission.length === 0 ||
      !process.env.STRIPE_PUBLISHABLE_KEY
    ) {
      for (const [action, section] of requestedPermission) {
        // "Billing off ⇒ everyone ULTIMATE" grants FEATURE tiers only. Org
        // ROLE gates (ADMIN) must stay enforced regardless of billing — a
        // plain member is not an admin just because we're not charging. Do
        // NOT conflate feature entitlement with authority.
        if (
          section === Sections.ADMIN &&
          !['ADMIN', 'SUPERADMIN'].includes(permission)
        ) {
          continue;
        }
        can(action, section);
      }
      return build({
        detectSubjectType: (item) =>
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          item.constructor,
      });
    }

    const { subscription, options } = await this.getPackageOptions(orgId);
    for (const [action, section] of requestedPermission) {
      // check for the amount of channels
      if (section === Sections.CHANNEL) {
        // Refreshing an existing channel doesn't add a new one, so skip the limit check
        // but only if the channel actually belongs to this org
        // The UI names the channel by its platform id (internalId); the
        // controller then checks the platform matches (hasChannel).
        if (refreshChannelId) {
          const existingIntegration = (
            await this._integrationService.getIntegrationsList(orgId)
          ).some(
            (i) =>
              String(i.internalId) === refreshChannelId ||
              i.id === refreshChannelId
          );
          if (existingIntegration) {
            can(action, section);
            continue;
          }
        }

        const totalChannels = channelsInUse(
          await this._integrationService.getIntegrationsList(orgId)
        );

        // Trialing orgs get their tier's platforms but only
        // TRIAL_CHANNEL_CAP slots until the trial converts.
        const subscriptionChannels = isTrailing
          ? Math.min(subscription?.totalChannels || 0, TRIAL_CHANNEL_CAP)
          : subscription?.totalChannels || 0;

        if (
          (options.channel && options.channel > totalChannels) ||
          subscriptionChannels > totalChannels
        ) {
          can(action, section);
          continue;
        }
      }

      if (section === Sections.WEBHOOKS) {
        const totalWebhooks = await this._webhooksService.getTotal(orgId);
        if (totalWebhooks < options.webhooks) {
          can(AuthorizationActions.Create, section);
          continue;
        }
      }

      if (section === Sections.AUTOPOST && options.autoPost) {
        // Creating a new feed must respect the per-plan cap; editing an
        // existing feed only needs the feature flag (no new feed is added).
        if (action !== AuthorizationActions.Create) {
          can(action, section);
          continue;
        }
        const totalAutoposts = await this._autopostService.getTotal(orgId);
        if (totalAutoposts < options.autoPostLimit) {
          can(action, section);
          continue;
        }
      }

      // check for posts per month
      if (section === Sections.POSTS_PER_MONTH && isDraft) {
        can(action, section);
        continue;
      }

      if (section === Sections.POSTS_PER_MONTH) {
        const createdAt =
          (await this._subscriptionService.getSubscription(orgId))?.createdAt ||
          created_at;
        const count = await this._postsService.countPostsFromDay(
          orgId,
          postsCycleStart(createdAt)
        );

        if (count < options.posts_per_month) {
          can(action, section);
          continue;
        }
      }

      if (section === Sections.TEAM_MEMBERS) {
        // Seat cap: `team_members` counts total seats INCLUDING the owner, so a
        // fresh org already fills one seat. Allow a new invite only while the
        // active-member count is below the tier's allowance (Starter=1 ⇒ solo,
        // no invites; Pro=2 ⇒ owner+1; Business=5 ⇒ owner+4).
        const activeMembers =
          await this._organizationService.getActiveMemberCount(orgId);
        if (activeMembers < options.team_members) {
          can(action, section);
        }
        continue;
      }

      if (
        section === Sections.ADMIN &&
        ['ADMIN', 'SUPERADMIN'].includes(permission)
      ) {
        can(action, section);
        continue;
      }

      if (
        section === Sections.COMMUNITY_FEATURES &&
        options.community_features
      ) {
        can(action, section);
        continue;
      }

      if (
        section === Sections.FEATURED_BY_GITROOM &&
        options.featured_by_gitroom
      ) {
        can(action, section);
        continue;
      }

      if (section === Sections.AI && options.ai) {
        can(action, section);
        continue;
      }

      if (
        section === Sections.IMPORT_FROM_CHANNELS &&
        options.import_from_channels
      ) {
        can(action, section);
      }
    }

    return build({
      detectSubjectType: (item) =>
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        item.constructor,
    });
  }
}
