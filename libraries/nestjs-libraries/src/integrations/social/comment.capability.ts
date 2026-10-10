import { Integration } from '@prisma/client';
import { safeJsonParse } from '@gitroom/helpers/utils/safe.json.parse';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

/**
 * Scopes the platform granted this token at connect time. Empty when the
 * channel was connected before we started recording them, or when the provider
 * can't report them — treated the same as "not granted", so a feature gated on
 * an optional scope stays off until the channel is reconnected.
 */
export const grantedScopesOf = (
  integration: Pick<Integration, 'grantedScopes'>
): string[] => {
  const parsed = safeJsonParse<string[]>(integration?.grantedScopes, []);
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * Why first comment does or doesn't work on this specific channel.
 *
 * - `yes`: comments go out.
 * - `no_api`: the platform gives apps no way to post a comment at all (TikTok's
 *   Content Posting API, YouTube today). Nothing the user can do about it.
 * - `not_granted`: the platform has the API, but this token lacks the
 *   permission, or we turned it off while it is under review.
 *
 * Provider-wide capability alone isn't enough: Meta grants pages_manage_engagement
 * only to accounts holding a role in the app, so one Facebook Page can take
 * comments while the next one can't. The composer and the publish workflow must
 * agree on this, or the user writes comments that get dropped at publish.
 */
export type CommentSupport = 'yes' | 'no_api' | 'not_granted';

export const commentSupport = (
  provider: Pick<
    SocialProvider,
    'comment' | 'commentsDisabled' | 'commentScope'
  > | null,
  integration: Pick<Integration, 'grantedScopes'>
): CommentSupport => {
  if (!provider?.comment) {
    return 'no_api';
  }

  if (provider.commentsDisabled) {
    return 'not_granted';
  }

  if (!provider.commentScope) {
    return 'yes';
  }

  return grantedScopesOf(integration).includes(provider.commentScope)
    ? 'yes'
    : 'not_granted';
};

/** Whether first comment works on this specific channel. */
export const canPostComments = (
  provider: Parameters<typeof commentSupport>[0],
  integration: Pick<Integration, 'grantedScopes'>
): boolean => commentSupport(provider, integration) === 'yes';
