// A URL taken from a query parameter or a stored "return to" value must not
// become `javascript:` in window.location or the router: that ran script in
// the app's origin (E2E-08-30, E2E-08-31).

const parse = (value: string, base: string) => {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
};

/** Where to go after sign-in: only a page of this app. */
export const sameOriginUrl = (
  value: string | null | undefined,
  origin: string
): string | null => {
  if (!value) return null;
  const url = parse(value, origin);
  return url &&
    url.origin === origin &&
    (url.protocol === 'https:' || url.protocol === 'http:')
    ? url.href
    : null;
};

/** A return address handed back by a connect flow: web pages and the app. */
export const isNavigableUrl = (value: string | null | undefined, origin: string) => {
  if (!value) return false;
  const url = parse(value, origin);
  return !!url && ['https:', 'http:', 'postra:'].includes(url.protocol);
};

/** The sign-out route itself, not any URL that mentions it. */
export const isLogoutPath = (pathname: string) =>
  pathname === '/auth/logout' || pathname.startsWith('/auth/logout/');
