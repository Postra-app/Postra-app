// Content-Security-Policy with a nonce drawn for every page request. nginx
// (var/docker/nginx.conf) enforces the policy that still allows inline
// scripts; this one is sent beside it as Content-Security-Policy-Report-Only,
// so browsers report what it would block without blocking anything. Once the
// reports stay empty it replaces the enforced one.
//
// script-src: only scripts with this request's nonce run, and whatever they
// load ('strict-dynamic'), so an injected <script> without the nonce does not.
// Next.js reads the nonce from this header on the request and puts it on its
// own scripts; the layout gives it to every <Script> through x-nonce. The host
// list stays for browsers without CSP3, which ignore 'strict-dynamic'.
// Every other directive is the enforced policy's (csp.spec.ts compares them).

export const CSP_REPORT_ONLY = 'Content-Security-Policy-Report-Only';
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
