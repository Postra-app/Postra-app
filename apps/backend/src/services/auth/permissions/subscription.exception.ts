import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
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

    const message = getErrorMessage(error);

    response.status(status).json({
      statusCode: status,
      message,
      url: process.env.FRONTEND_URL + '/billing',
    });
  }
}

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
    // Inviting with every seat taken said "not included in your plan"
    // (E2E-07-38).
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
