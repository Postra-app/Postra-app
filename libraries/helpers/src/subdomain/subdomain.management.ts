import { parse } from 'tldts';

export function getCookieUrlFromDomain(domain: string) {
  const url = parse(domain);
  return url.domain! ? '.' + url.domain! : url.hostname!;
}

/**
 * The domain Postra's cookies were set for until E2E-11-78 (`.postra.co.uk`
 * for app.postra.co.uk), kept only to expire what browsers still hold. None
 * for a bare host such as localhost, where nothing was domain-wide.
 *
 * New cookies are host-only: a Domain sent them, the session token included,
 * to every subdomain - the landing pages, the CDN and the status page GitHub
 * Pages serves.
 */
export function legacyCookieDomain(
  frontendUrl: string = process.env.FRONTEND_URL || ''
) {
  const domain = frontendUrl ? getCookieUrlFromDomain(frontendUrl) : '';
  return domain?.startsWith('.') ? domain : undefined;
}
