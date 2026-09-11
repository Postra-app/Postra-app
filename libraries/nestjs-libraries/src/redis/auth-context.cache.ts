import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// user+orgs resolution runs on EVERY authenticated request (two joined
// queries); auth.middleware caches it per user for a short window. The key +
// busters live here (not in the backend middleware) so the library services
// that mutate permissions — subscription downgrade/cancel, member disable —
// can invalidate stale entries too, instead of a removed/downgraded user
// keeping access for up to the TTL.
export const AUTH_CACHE_TTL_SECONDS = 30;

export const authContextCacheKey = (userId: string) => `authctx:${userId}`;

export const bustAuthContextCache = (userId: string) =>
  ioRedis.del(authContextCacheKey(userId)).catch(() => {});

export const bustAuthContextCacheForUsers = (userIds: string[]) =>
  userIds.length
    ? ioRedis.del(...userIds.map(authContextCacheKey)).catch(() => {})
    : Promise.resolve(0);

// How often a user's lastOnline may be rewritten. The column has existed since
// the schema was written and nothing ever wrote to it, so DAU/WAU/MAU — which
// count users whose lastOnline falls inside a window — were counting sign-ups.
// Measured on production: a full evening of clicking around as a signed-in
// admin left DAU at 0 (E2E-09-03).
//
// Every authenticated request would otherwise be a write, so the touch is
// throttled through Redis: one row update per user per window, and none at all
// when Redis is unavailable.
export const LAST_ONLINE_THROTTLE_SECONDS = 15 * 60;

const lastOnlineKey = (userId: string) => `lastonline:${userId}`;

/** True when this user has not been marked online inside the window. */
export const claimLastOnlineWrite = async (userId: string) => {
  try {
    const claimed = await ioRedis.set(
      lastOnlineKey(userId),
      '1',
      'EX',
      LAST_ONLINE_THROTTLE_SECONDS,
      'NX'
    );
    return claimed === 'OK';
  } catch {
    return false;
  }
};
