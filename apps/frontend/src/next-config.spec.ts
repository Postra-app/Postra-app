import { readFileSync } from 'fs';
import { join } from 'path';

// next.config.js is ESM wrapped in withSentryConfig, so it is read as text.
const config = readFileSync(join(__dirname, '..', 'next.config.js'), 'utf8');

describe('next.config.js public surface', () => {
  // Next.js adds x-powered-by by default (docs: poweredByHeader); the app
  // host answered with it on 2026-10-22.
  it('does not announce Next.js in x-powered-by', () => {
    expect(config).toMatch(/poweredByHeader:\s*false/);
  });

  // RFC 9116 §3.1: security.txt applies only to the host it was fetched
  // from, and a retrieval may result in a redirect. The app host had none
  // (404, 2026-10-22); the landing's file is the one source.
  it('redirects /.well-known/security.txt to the landing copy', () => {
    expect(config).toContain("source: '/.well-known/security.txt'");
    expect(config).toContain(
      "destination: 'https://postra.co.uk/.well-known/security.txt'"
    );
  });
});
