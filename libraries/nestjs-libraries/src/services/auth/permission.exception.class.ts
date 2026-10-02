import { HttpException, HttpStatus } from '@nestjs/common';

export enum Sections {
  CHANNEL = 'channel',
  POSTS_PER_MONTH = 'posts_per_month',
  VIDEOS_PER_MONTH = 'videos_per_month',
  TEAM_MEMBERS = 'team_members',
  COMMUNITY_FEATURES = 'community_features',
  FEATURED_BY_GITROOM = 'featured_by_gitroom',
  AI = 'ai',
  IMPORT_FROM_CHANNELS = 'import_from_channels',
  ADMIN = 'admin',
  WEBHOOKS = 'webhooks',
  AUTOPOST = 'autoPost',
}

export enum AuthorizationActions {
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
}

export class SubscriptionException extends HttpException {
  constructor(message: { section: Sections; action: AuthorizationActions }) {
    super(message, HttpStatus.PAYMENT_REQUIRED);
  }
}

/**
 * Authority, not entitlement.
 *
 * `Sections.ADMIN` fails when the member's role in the *active* organization is
 * below ADMIN — nothing about their plan is wrong, and upgrading it would not
 * help. Answering 402 there sends a team member to the billing page to pay for
 * a permission that money cannot buy, and the global 402 handler opens a "Go to
 * billing" dialog on top of it. Every other section really is a plan limit and
 * keeps 402.
 */
export class PermissionDeniedException extends HttpException {
  constructor(message: { section: Sections; action: AuthorizationActions }) {
    super(message, HttpStatus.FORBIDDEN);
  }
}
