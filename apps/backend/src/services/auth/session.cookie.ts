import { Response } from 'express';
import {
  expireDomainWideCookies,
  sessionCookieOptions,
} from '@gitroom/nestjs-libraries/services/auth/remove.auth';

// One definition for every auth cookie we set. It used to be copy-pasted per
// route, which is how /activate and /oauth/:provider/exists drifted to
// `sameSite: 'none'` — that ships the session cookie on cross-site requests,
// and since the API has no CSRF tokens, every freshly-activated user was
// CSRF-able until their next login. `lax` still covers the flows that set it:
// they are top-level navigations from our own email/OAuth redirect.
// Cookie lifetime is pinned to the JWT lifetime (30d). It used to be 365d,
// which left an expired-token cookie sitting in the browser for 11 months after
// the JWT it carried had died.
export const AUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
// Host-only, like every Postra cookie (sessionCookieOptions).
export const authCookieOptions = () => ({
  ...sessionCookieOptions(),
  expires: new Date(Date.now() + AUTH_COOKIE_MAX_AGE_MS),
});

// A new session replaces whatever the browser held, including the
// domain-wide cookies from before cookies became host-only: an older `auth`
// is sent first and would win over the one set here. Signing in and an
// administrator's second factor (admin-mfa.controller.ts) both end here.
export const setSessionCookie = (response: Response, jwt: string) => {
  expireDomainWideCookies(response);
  response.cookie('auth', jwt, authCookieOptions());
};
