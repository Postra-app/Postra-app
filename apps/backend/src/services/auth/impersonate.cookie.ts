import { Response } from 'express';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';

/**
 * How long a session may wear someone else's identity before it lapses.
 *
 * It used to be a year, with no record on the server that the impersonation was
 * even running — no time box, no "it ended" event, no way to list or cut a live
 * one. An admin who closed the tab mid-session came back to it a week later,
 * and everything done from that tab was filed under the customer's name
 * (E2E-09-28). The middleware re-issues the cookie on every request, so this is
 * an inactivity window, not a hard stop mid-task.
 */
export const IMPERSONATE_MAX_AGE_MS = 30 * 60 * 1000;

const baseOptions = () => ({
  domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
  ...(!process.env.NOT_SECURED
    ? {
        secure: true,
        httpOnly: true as const,
        sameSite: 'lax' as const,
      }
    : {}),
});

export const setImpersonateCookie = (res: Response, id: string) => {
  res.cookie('impersonate', id, {
    ...baseOptions(),
    expires: new Date(Date.now() + IMPERSONATE_MAX_AGE_MS),
    maxAge: IMPERSONATE_MAX_AGE_MS,
  });
};

/**
 * Actually remove it. "Stop" used to post an empty id down the same path that
 * starts an impersonation, which wrote an empty cookie for another year and
 * logged a row indistinguishable from a start (E2E-09-06c).
 */
export const clearImpersonateCookie = (res: Response) => {
  res.cookie('impersonate', '', {
    ...baseOptions(),
    expires: new Date(0),
    maxAge: -1,
  });
};
