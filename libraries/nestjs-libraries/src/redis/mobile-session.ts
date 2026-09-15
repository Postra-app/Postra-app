import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Revocable sessions for the native app.
 *
 * The browser's token can afford to live 30 days: it rides in an httpOnly
 * cookie that logging out deletes, so the session ends when the cookie does.
 * The app has no cookie — it keeps the token in the Keychain, and `/user/logout`
 * only ever cleared the cookie. Measured on production: sign in, sign out, and
 * the very same token still answered 200 on /user/self for the rest of the
 * month (E2E-10-17).
 *
 * The obvious lever, bumping `user.tokenVersion`, is too blunt: it ends every
 * session that user has, so signing out on the phone would sign them out of the
 * browser mid-edit. Instead a mobile token carries its own session id, and this
 * is the list of the ones that have been revoked. Web tokens carry no `sid` and
 * never reach the check.
 *
 * The list is short-lived by construction: an entry only has to outlive the
 * tokens it revokes, and those expire within MOBILE_TOKEN_TTL of being issued.
 */
export const MOBILE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** jsonwebtoken's `expiresIn`, kept in step with the TTL above. */
export const MOBILE_TOKEN_EXPIRES_IN = `${MOBILE_TOKEN_TTL_SECONDS}s`;

const revokedKey = (sid: string) => `mobilesession:revoked:${sid}`;

/**
 * End a mobile session. Every token carrying this id stops being accepted,
 * including ones refresh has already handed out — refresh keeps the id.
 */
export const revokeMobileSession = (sid: string) =>
  ioRedis
    .set(revokedKey(sid), '1', 'EX', MOBILE_TOKEN_TTL_SECONDS)
    .catch(() => null);

/**
 * Fails open, deliberately. Treating an unreachable Redis as "revoked" would
 * turn any blip into a mass sign-out: every phone gets a 401, clears its
 * Keychain and asks for the password again. That is a far likelier event than
 * someone using a token from a session its owner has already ended, and the
 * exposure is bounded anyway — the token dies on its own within
 * MOBILE_TOKEN_TTL. Auth already treats Redis as a cache it can live without
 * (see auth-context.cache); this keeps that property.
 */
export const isMobileSessionRevoked = async (sid: string): Promise<boolean> => {
  try {
    return (await ioRedis.exists(revokedKey(sid))) === 1;
  } catch {
    return false;
  }
};
