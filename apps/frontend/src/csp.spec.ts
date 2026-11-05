import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { newNonce, nonceCsp } from './csp';
import { proxy } from './proxy';

// The nonce policy runs report-only beside the one nginx enforces
// (var/docker/nginx.conf). It drops 'unsafe-inline' from script-src: only
// scripts carrying this request's nonce, and what they load ('strict-dynamic'),
// may run. Everything else must match the enforced policy, so the reports
// speak about scripts and nothing else.

const directives = (policy: string) =>
  new Map(
    policy
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.split(' ')[0], d] as const)
  );

const enforced = (() => {
  const conf = readFileSync(
    join(__dirname, '..', '..', '..', 'var', 'docker', 'nginx.conf'),
    'utf8'
  );
  const match = conf.match(
    /add_header Content-Security-Policy "(default-src 'self'[^"]+)"/
  );
  if (!match) throw new Error('no app Content-Security-Policy in nginx.conf');
  return directives(match[1]);
})();

describe('nonce Content-Security-Policy', () => {
  const nonce = newNonce();
  const policy = directives(nonceCsp(nonce));

  it('lets only scripts with the nonce run, and what they load', () => {
    const script = policy.get('script-src')!;
    expect(script).toContain(`'nonce-${nonce}'`);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it('matches the enforced policy in every other directive', () => {
    expect([...policy.keys()].sort()).toEqual([...enforced.keys()].sort());
    for (const [name, value] of enforced) {
      if (name === 'script-src') continue;
      expect(policy.get(name)).toBe(value);
    }
  });

  it('draws a new nonce every time, unguessable and header-safe', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(nonces.size).toBe(50);
    for (const n of nonces) {
      expect(n).toMatch(/^[A-Za-z0-9+/]{40,}={0,2}$/);
    }
  });
});

describe('proxy - nonce policy on pages', () => {
  const page = (path: string, cookie?: string) =>
    proxy(
      new NextRequest(new URL(path, 'https://app.postra.co.uk'), {
        headers: cookie ? { cookie } : {},
      })
    );

  for (const [label, path, cookie] of [
    ['a signed-in page', '/launches', 'auth=token'],
    ['the login page', '/auth/login', undefined],
  ] as const) {
    it(`sends it report-only on ${label}, with the nonce handed to the render`, async () => {
      const res = await page(path, cookie);
      const header = res.headers.get('content-security-policy-report-only');
      expect(header).toBeTruthy();
      expect(res.headers.get('content-security-policy')).toBeNull();
      const nonce = header!.match(/'nonce-([^']+)'/)![1];
      // NextResponse.next({ request: { headers } }) forwards the request
      // headers the render reads (Next picks the nonce out of the policy,
      // the layout takes x-nonce for its <Script> tags).
      expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
      expect(
        res.headers.get('x-middleware-request-content-security-policy-report-only')
      ).toBe(header);
    });
  }

  it('draws a different nonce for each request', async () => {
    const a = (await page('/auth/login')).headers.get('content-security-policy-report-only');
    const b = (await page('/auth/login')).headers.get('content-security-policy-report-only');
    expect(a).not.toBe(b);
  });
});
