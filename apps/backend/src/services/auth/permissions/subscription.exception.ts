import {
  planLabel,
  planLimits,
  pricing,
  TRIAL_CHANNEL_CAP,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import {
  AuthorizationActions,
  PermissionDeniedException,
  Sections,
  SubscriptionException,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

@Catch(SubscriptionException)
export class SubscriptionExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const error: { section: Sections; action: AuthorizationActions } =
      exception.getResponse() as any;

    const org = ctx.getRequest()?.org;
    const trial = org?.isTrailing
      ? trialLimitMessage(error, org?.subscription?.subscriptionTier)
      : null;
    const message = trial || getErrorMessage(error);
    // Billing is for admins (BILLING_ADMIN): a plain member sent to it lands
    // on a page they cannot use. A web session says whether the member can
    // act on the 402; API key and OAuth requests carry no member and get
    // nothing new (upstream 4c557f114).
    const role = org?.users?.[0]?.role;

    response.status(status).json({
      statusCode: status,
      message,
      // The page offers "End the trial now" instead of "Go to billing".
      ...(trial ? { trial: true } : {}),
      url: process.env.FRONTEND_URL + '/billing',
      ...(role
        ? { canManageBillingUi: role === 'SUPERADMIN' || role === 'ADMIN' }
        : {}),
    });
  }
}

// Business has 10 000 webhooks and Pro/Business a million posts: both are
// "unlimited" on the plan pages.
const UNLIMITED = 10000;
const count = (n: number, one: string, many: string, suffix = '') =>
  n >= UNLIMITED ? `unlimited ${many}` : `${n} ${n === 1 ? one : many}${suffix}`;

// A limit reached during the free trial is the trial's, not the plan's: the
// customer already chose the plan, so "upgrade" told them nothing. Says what
// the trial includes, what their plan includes, and that ending the trial
// starts the plan (Billing; the page offers it). Null for a section the
// trial does not limit on its own: the plan's wording then applies.
export const trialLimitMessage = (
  error: { section: Sections; action: AuthorizationActions },
  tier?: string | null
): string | null => {
  const paid = tier && tier !== 'FREE' && pricing[tier] ? tier : 'STANDARD';
  const plan = planLimits(paid, false);
  const trial = planLimits(paid, true);
  const yours = `Your ${planLabel(paid)} plan includes`;
  const end = 'End the trial to start your plan now.';
  switch (error.section) {
    case Sections.CHANNEL:
      return `Your free trial includes ${count(TRIAL_CHANNEL_CAP, 'channel', 'channels')}. ${yours} ${count(plan.channel || 0, 'channel', 'channels')}. ${end}`;
    case Sections.POSTS_PER_MONTH:
      return `Your free trial includes ${count(trial.posts_per_month, 'post', 'posts')}. ${yours} ${count(plan.posts_per_month, 'post', 'posts', ' a month')}. ${end}`;
    case Sections.WEBHOOKS:
      return `Your free trial includes ${count(trial.webhooks, 'webhook', 'webhooks')}. ${yours} ${count(plan.webhooks, 'webhook', 'webhooks')}. ${end}`;
    case Sections.AUTOPOST:
      return `Your free trial includes ${count(trial.autoPostLimit, 'Auto Post feed', 'Auto Post feeds')}. ${yours} ${count(plan.autoPostLimit, 'Auto Post feed', 'Auto Post feeds')}. ${end}`;
    case Sections.TEAM_MEMBERS: {
      const seats = (t: string) =>
        pricing[t].team_members >= UNLIMITED
          ? `${planLabel(t)} is unlimited`
          : `${planLabel(t)} has ${pricing[t].team_members}`;
      return `The free trial is for one person. Team invites open with a plan that has team seats: ${seats('PRO')}, ${seats('ULTIMATE')}.`;
    }
    default:
      return null;
  }
};

// Exported for the spec that pins "no section may map to undefined".
export const getErrorMessage = (error: {
  section: Sections;
  action: AuthorizationActions;
}) => {
  switch (error.section) {
    case Sections.POSTS_PER_MONTH:
      switch (error.action) {
        default:
          return 'You have reached the maximum number of posts for your subscription. Please upgrade your subscription to add more posts.';
      }
    case Sections.CHANNEL:
      switch (error.action) {
        default:
          return 'You have reached the maximum number of channels for your subscription. Please upgrade your subscription to add more channels.';
      }
    case Sections.WEBHOOKS:
      switch (error.action) {
        default:
          return 'You have reached the maximum number of webhooks for your subscription. Please upgrade your subscription to add more webhooks.';
      }
    case Sections.VIDEOS_PER_MONTH:
      switch (error.action) {
        default:
          return 'You have reached the maximum number of generated videos for your subscription. Please upgrade your subscription to generate more videos.';
      }
    // Inviting with every seat taken said "not included in your plan".
    case Sections.TEAM_MEMBERS:
      return "Your plan's team seats are all taken. Remove someone from the team or upgrade your plan to invite more people.";
    case Sections.AUTOPOST:
      return `Auto Post feeds by plan: Starter (${pricing.STANDARD.autoPostLimit} RSS feeds), Pro (${pricing.PRO.autoPostLimit}) and Business (${pricing.ULTIMATE.autoPostLimit}), and your plan has no feeds left. Upgrade your subscription to add another feed.`;
    // Every other section (AI, ADMIN, ...) used to fall out of this switch as
    // `undefined`,
    // which JSON.stringify then dropped: the client received a bare
    // `{statusCode: 402, url}` and the global handler opened an empty dialog.
    // Never return undefined from here again.
    default:
      return 'This feature is not included in your current plan. Please upgrade your subscription to use it.';
  }
};

/**
 * The 403 counterpart. Deliberately carries no billing URL: the member cannot
 * fix this by paying, only an ADMIN or SUPERADMIN of the organization can grant
 * them the role.
 */
@Catch(PermissionDeniedException)
export class PermissionDeniedExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    response.status(exception.getStatus()).json({
      statusCode: exception.getStatus(),
      message:
        'You do not have permission to do this. Ask an admin of this organization to give you the required role.',
    });
  }
}
