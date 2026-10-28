/**
 * `NOT_SECURED` is for plain-http development: it drops the Secure, HttpOnly
 * and SameSite flags from every cookie, hands the session token back in
 * response headers, opens CORS to localhost and serves Swagger. Nothing kept
 * it off a server that serves https, where any of that hands sessions to
 * scripts and other sites (planned as A18 in July). Refuse to start
 * instead.
 */
export const assertNotSecuredOnlyOverHttp = (
  env: NodeJS.ProcessEnv = process.env
) => {
  if (env.NOT_SECURED && /^https:\/\//i.test(env.FRONTEND_URL || '')) {
    throw new Error(
      'NOT_SECURED is set while FRONTEND_URL is https: it is for local http development only'
    );
  }
};
