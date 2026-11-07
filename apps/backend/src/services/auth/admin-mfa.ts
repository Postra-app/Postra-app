// A Postra administrator (User.isSuperAdmin) can act as every customer: open
// their organisations, change plans, delete accounts. A password alone used to
// be enough for that. Now the administrator powers of a session need a second
// factor, an authenticator code checked by admin-mfa.controller.ts, which
// reissues the session token with `mfa` = when the code was checked.
//
// auth.middleware.ts reads the flag from the database on every request and
// lowers it on the request's copy of the user while the session has no fresh
// `mfa`: every `user.isSuperAdmin` gate in the product, impersonation
// included, stays closed without each of them knowing about this. The
// administrator is meanwhile an ordinary member of their own organisations.
//
// All of this applies only with ADMIN_TOTP_REQUIRED="true". Off (the default),
// the password alone opens the administrator powers, as it did before; the
// authenticator a user already set up stays stored for the day it is on again.
export const adminMfaRequired = (): boolean =>
  process.env.ADMIN_TOTP_REQUIRED === 'true';

// NIST SP 800-63B-4 asks AAL2 to reauthenticate at least every 24 hours; an
// administrator session asks for a code twice as often.
export const ADMIN_MFA_MAX_AGE_SECONDS = 12 * 60 * 60;

// A clock a little ahead on another instance must not make a fresh claim look
// like it comes from the future.
const CLOCK_SKEW_SECONDS = 60;

export const adminMfaFresh = (
  payload: { mfa?: unknown } | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean => {
  const mfa = payload?.mfa;
  return (
    typeof mfa === 'number' &&
    mfa <= nowSeconds + CLOCK_SKEW_SECONDS &&
    nowSeconds - mfa < ADMIN_MFA_MAX_AGE_SECONDS
  );
};

// Five wrong codes and the second step stops for a quarter of an hour, per
// administrator, whatever address the attempts come from: six digits are a
// million possibilities, and this keeps a guesser at 480 tries a day.
export const ADMIN_MFA_MAX_FAILURES = 5;
export const ADMIN_MFA_LOCK_SECONDS = 15 * 60;
export const adminMfaFailuresKey = (userId: string) =>
  `admin_mfa_failures:${userId}`;
