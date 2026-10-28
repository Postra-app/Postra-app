import { Response } from 'express';
import { legacyCookieDomain } from '@gitroom/helpers/subdomain/subdomain.management';

/**
 * Attributes of Postra's own cookies. Host-only - no Domain - so the browser
 * returns them to the app's host and nowhere else (OWASP Session
 * Management: "the Domain attribute should not be set"). The flags wait for
 * HTTPS: NOT_SECURED is plain-http local development.
 */
export const sessionCookieOptions = () => ({
  path: '/',
  ...(!process.env.NOT_SECURED
    ? { secure: true, httpOnly: true as const, sameSite: 'lax' as const }
    : {}),
});

const expired = () => ({ expires: new Date(0), maxAge: -1 });

/** The cookies that were domain-wide and outlive a page view. */
export const DOMAIN_WIDE_COOKIES = ['auth', 'showorg', 'impersonate'];

/**
 * Expire the domain-wide copies a browser still holds from before cookies became host-only.
 * Left alone, an older `auth` or `showorg` is sent first and wins over the
 * host-only one, and the old session token keeps reaching every subdomain.
 */
export const expireDomainWideCookies = (
  res: Response,
  names: string[] = DOMAIN_WIDE_COOKIES
) => {
  const domain = legacyCookieDomain();
  if (!domain) {
    return;
  }
  for (const name of names) {
    res.cookie(name, '', { ...sessionCookieOptions(), domain, ...expired() });
  }
};

/** Clear cookies the session set, host-only copy and domain-wide leftover. */
export const clearSessionCookies = (
  res: Response,
  names: string[] = DOMAIN_WIDE_COOKIES
) => {
  for (const name of names) {
    res.cookie(name, '', { ...sessionCookieOptions(), ...expired() });
  }
  expireDomainWideCookies(res, names);
};

// Clears the session cookie. Lives in the library because the global
// exception filter calls it; it used to be imported from the backend app,
// which made the library depend on the app (and close a cycle with the auth
// middleware).
export const removeAuth = (res: Response) => {
  clearSessionCookies(res, ['auth']);
  res.header('logout', 'true');
};
