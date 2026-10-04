import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

// Copy of @nestjs/throttler's THROTTLER_LIMIT constant (not exported from the
// package root); @Throttle() stores metadata under `${THROTTLER_LIMIT}${name}`.
const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';

/**
 * The client address as seen by the one proxy we trust (the ALB).
 *
 * Exported so a spec can pin the choice of the last hop: reading the first one
 * lets any caller mint a throttle bucket per request just by sending the header.
 */
export const clientIpFromForwardedFor = (header?: string): string => {
  const hops = (header || '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops[hops.length - 1] || '';
};

/**
 * CopilotKit asks the AI runtime which agents exist on every page load
 * (`availableAgents` on POST /copilot/chat). It reads metadata and calls no
 * model, but it counted toward the route's AI limit, so a team clicking
 * around used up its organisation's allowance in minutes. Only a document
 * without a mutation qualifies: GraphQL runs the operation named
 * `operationName`, and a mutation can carry any name.
 */
export const isCopilotMetadataQuery = (body: unknown): boolean => {
  const { operationName, query } = (body || {}) as {
    operationName?: unknown;
    query?: unknown;
  };
  return (
    operationName === 'availableAgents' &&
    typeof query === 'string' &&
    !/\b(mutation|subscription)\b/i.test(query)
  );
};

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { url, method, body } = context
      .switchToHttp()
      .getRequest<Request>();

    if (
      method === 'POST' &&
      url.includes('/copilot/chat') &&
      isCopilotMetadataQuery(body)
    ) {
      return true;
    }

    // Public posting API (existing behaviour).
    if (method === 'POST' && url.includes('/public/v1/posts')) {
      return super.canActivate(context);
    }

    // Authentication endpoints — enforce throttling to stop brute-force and
    // abuse. login/register/forgot carry their own @Throttle limits; other
    // /auth POSTs fall back to the global default limit. These are
    // unauthenticated, so getTracker buckets them by client IP.
    if (method === 'POST' && url.includes('/auth/')) {
      return super.canActivate(context);
    }

    // Routes carrying an explicit @Throttle() — the expensive AI/media/render
    // endpoints — are enforced with their own limit+ttl (the decorator
    // overrides the global default per route).
    const hasExplicitThrottle =
      this.reflector.getAllAndOverride<number | undefined>(
        THROTTLER_LIMIT_DEFAULT,
        [context.getHandler(), context.getClass()]
      ) !== undefined;
    if (hasExplicitThrottle) {
      return super.canActivate(context);
    }

    // Everything else is intentionally not throttled.
    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    // Authenticated routes carry an org context — keep the per-org buckets.
    if (req?.org?.id) {
      return (
        req.org.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
      );
    }

    // Unauthenticated routes (auth endpoints): bucket by client IP. The app
    // runs behind exactly one proxy (the ALB) without express `trust proxy`,
    // so read the forwarded client IP, falling back to the socket address.
    //
    // Take the LAST entry, not the first. X-Forwarded-For is append-only: each
    // hop adds what it saw, so with one trusted proxy the tail is the ALB's own
    // observation and everything before it is whatever the client chose to
    // send. Reading index 0 handed the bucket key to the caller — sending
    // `X-Forwarded-For: <anything>` produced a fresh bucket on every request
    // and the per-IP limits on login, register and forgot stopped applying
    //. Reaching the app without going through the ALB
    // is not possible: the security group only accepts port 5000 from the
    // load balancer's own group, and a request that arrives with no header at
    // all still falls through to the socket address below.
    const ip =
      clientIpFromForwardedFor(req.headers?.['x-forwarded-for'] as string) ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown';
    return 'ip_' + ip;
  }
}
