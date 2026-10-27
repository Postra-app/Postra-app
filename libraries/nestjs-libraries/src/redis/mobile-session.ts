import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Revocable sessions for the native app.
 *
 * The browser's token can afford to live 30 days: it rides in an httpOnly
 * cookie that logging out deletes, so the session ends when the cookie does.
 * The app has no cookie — it keeps the token in the Keychain, and `/user/logout`
 * only ever cleared the cookie. Measured on production: sign in, sign out, and
 * the very same token still answered 200 on /user/self for the rest of the
 * month.
 *
 * The obvious lever, bumping `user.tokenVersion`, is too blunt: it ends every
 * session that user has, so signing out on the phone would sign them out of the
 * browser mid-edit. Instead a token carries its own session id, and this is the
 * list of the ones that have been revoked. Since E2E-11-74 browser tokens carry
 * one too: deleting the cookie ended the browser's copy only, and a copied
 * cookie kept working for the rest of its 30 days.
 *
 * An entry only has to outlive the tokens it revokes: a week for the app, the
 * rest of the token's life for the browser (the caller passes it).
 */
export const MOBILE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long a session lasts from signing in, however often the app refreshes
 * its token: the browser's token already ends here. Tokens carry the sign-in
 * time as `sat` (E2E-11-80, NIST SP 800-63B-4: a definite overall timeout, no
 * more than 30 days at AAL1).
 */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** jsonwebtoken's `expiresIn`, kept in step with the TTL above. */
export const MOBILE_TOKEN_EXPIRES_IN = `${MOBILE_TOKEN_TTL_SECONDS}s`;

const revokedKey = (sid: string) => `mobilesession:revoked:${sid}`;

/**
 * End a mobile session. Every token carrying this id stops being accepted,
 * including ones refresh has already handed out — refresh keeps the id.
 */
export const revokeMobileSession = (
  sid: string,
  ttlSeconds: number = MOBILE_TOKEN_TTL_SECONDS
) => ioRedis.set(revokedKey(sid), '1', 'EX', ttlSeconds).catch(() => null);

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
