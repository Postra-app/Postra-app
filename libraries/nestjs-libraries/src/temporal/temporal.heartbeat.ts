import {
  ApplicationFailure,
  CancelledFailure,
  Context,
} from '@temporalio/activity';
import { PUBLISHING_PREFIX } from '@gitroom/nestjs-libraries/temporal/temporal.publishing';

// Heartbeats for the publishing activities (postSocial, postComment), ported
// from upstream's temporal.heartbeat.ts and extended with markPublishing.
//
// Why: post.workflow.v1.0.9 gives those activities a 3-minute heartbeatTimeout,
// so a worker that dies mid-publish (deploy, watchdog restart, OOM) is noticed
// in 3 minutes instead of at the 10-30 minute startToCloseTimeout. The timeout
// failure carries the last heartbeat details, and the workflow reads them to
// decide whether the platform could have received the post: before
// markPublishing nothing has been sent, so retrying cannot duplicate the post.
//
// Details hang off the per-activity Context, not a provider field: providers
// are singletons shared by every activity on the worker.
const HEARTBEAT_INTERVAL = 15_000;
const DETAILS = Symbol.for('postra.heartbeatDetails');

const current = (): any | undefined => {
  try {
    return Context.current();
  } catch {
    return undefined; // not inside an activity
  }
};

// Records what the activity is doing. Sent with the next 15 s heartbeat.
export const setHeartbeatDetails = (details: string) => {
  const ctx = current();
  if (ctx) ctx[DETAILS] = details;
};

// Called right before the first request that can reach the platform. Sends the
// heartbeat now instead of at the next tick: if the worker dies a second later,
// the server must already know that publishing had started. The worker sends
// heartbeats at most once a second (maxHeartbeatThrottleInterval in
// temporal.module.ts), so this lands within a second.
//
// Throws instead when Temporal has already given up on this attempt (e.g. a
// heartbeat timeout while the event loop was stuck): the workflow may be
// retrying it elsewhere, and only one of them may reach the platform.
export const markPublishing = (what: string) => {
  const ctx = current();
  if (!ctx) return;
  if (ctx.cancellationSignal?.aborted) {
    throw new CancelledFailure(
      `${what}: attempt cancelled by Temporal before publishing`
    );
  }
  ctx[DETAILS] = `${PUBLISHING_PREFIX} ${what}`;
  try {
    ctx.heartbeat(ctx[DETAILS]);
  } catch {
    /* heartbeating must never fail the activity */
  }
};

// For errors thrown by the platform call. An untyped error after
// markPublishing (a request timeout, a dropped connection) leaves the outcome
// unknown: the platform may have accepted the post before the answer got lost,
// so it must not be retried. Typed failures (bad_body, refresh_token, ...) are
// the provider's own verdict and pass through, as does anything thrown before
// publishing started, which is safe to retry.
export const afterPublishing = (err: unknown): unknown => {
  const ctx = current();
  const publishing =
    typeof ctx?.[DETAILS] === 'string' &&
    ctx[DETAILS].startsWith(PUBLISHING_PREFIX);
  if (!publishing || err instanceof ApplicationFailure) return err;
  return ApplicationFailure.create({
    message: (err as Error)?.message || String(err),
    type: 'publish_unknown',
    nonRetryable: true,
  });
};

export const withHeartbeat = async <T>(fn: () => Promise<T>): Promise<T> => {
  const ctx = current();
  if (!ctx) return fn();

  setHeartbeatDetails(`${ctx.info?.activityType || 'activity'}: entered`);

  let logged = false;
  const interval = setInterval(() => {
    try {
      // resend the last details, or this keepalive would blank them out
      ctx.heartbeat(ctx[DETAILS]);
    } catch (err) {
      if (!logged) {
        logged = true;
        console.error('withHeartbeat: heartbeat failed', err);
      }
    }
  }, HEARTBEAT_INTERVAL);

  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
};
