// Content-Security-Policy with a nonce drawn for every page request, enforced
// on every page (it ran report-only first, with nothing legitimate reported).
// nginx (var/docker/nginx.conf) still sends its own policy on every response;
// a browser enforces both, so its 'unsafe-inline' opens nothing on a page,
// and it keeps covering what never passes through here (API, static files).
//
// script-src: only scripts with this request's nonce run, and whatever they
// load ('strict-dynamic'), so an injected <script> without the nonce does not.
// Next.js reads the nonce from this header on the request and puts it on its
// own scripts; the layout gives it to every <Script> through x-nonce. The host
// list stays for browsers without CSP3, which ignore 'strict-dynamic'.
// Every other directive is the enforced policy's (csp.spec.ts compares them).

export const CSP_HEADER = 'Content-Security-Policy';
export const NONCE_HEADER = 'x-nonce';

export const newNonce = () => btoa(crypto.randomUUID());

export const nonceCsp = (nonce: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https://plausible.io`,
    "style-src 'self' 'unsafe-inline'",
    'img-src \'self\' data: blob: https:',
    'media-src \'self\' data: blob: https:',
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://www.youtube.com https://www.youtube-nocookie.com https://status.postra.co.uk",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'report-uri /api/public/csp-report',
  ].join('; ');
