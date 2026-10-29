import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSP_REPORT_PATH = '/public/csp-report';

/**
 * Cross-site request forgery, second layer. The session
 * cookie is SameSite=Lax, so another site cannot send it with a POST; OWASP
 * counts that as defence in depth rather than the defence. Here a change that
 * rides the session cookie must come from one of our own pages, by the
 * `Origin` the browser puts on every POST.
 *
 * Only cookie sessions: the mobile app, server-side fetches and API keys
 * authenticate with a header, which another site cannot make a browser send.
 * Webhooks and OAuth callbacks carry no session cookie. A request without
 * `Origin` passes - browsers send it on cross-site POSTs, so its absence is a
 * non-browser client, and SameSite still holds.
 */
export const sameOriginGuard =
  (allowedOrigins: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }
    // Browsers post CSP violation reports with the cookie and, in Safari,
    // `Origin: null`. The route changes nothing and always answers 204.
    if (req.path === CSP_REPORT_PATH) {
      return next();
    }
    if (!req.cookies?.auth || req.headers.auth) {
      return next();
    }
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes(origin)) {
      return next();
    }
    return res.status(403).json({ message: 'Cross-site request refused' });
  };

/** The origins our own pages are served from. */
export const ownOrigins = (env: NodeJS.ProcessEnv = process.env) =>
  [env.FRONTEND_URL, env.MAIN_URL]
    .filter((u): u is string => !!u)
    .map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return '';
      }
    })
    .filter(Boolean);
