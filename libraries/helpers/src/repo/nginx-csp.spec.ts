import { readFileSync } from 'fs';
import { join } from 'path';

// The app's Content-Security-Policy is enforced (2026-10-15) after it ran
// report-only from 2026-10-09: no report in the logs since the deploy of
// 10-13, and a click-through of calendar, composer, media library, Studio
// (templates, Pixabay, Unsplash), agent, analytics, Auto Post, plugs,
// settings, billing and admin sent none either, while a test frame to an
// unknown host was reported. Reports keep going to /api/public/csp-report.

const conf = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'var', 'docker', 'nginx.conf'),
  'utf8'
);
const appHeaders = [
  ...conf.matchAll(/add_header\s+(Content-Security-Policy(?:-Report-Only)?)\s+"([^"]+)"/g),
].map((m) => ({ name: m[1], value: m[2] }));
const appPolicy = appHeaders.find((h) => h.value.includes("default-src 'self'"));

describe('var/docker/nginx.conf Content-Security-Policy', () => {
  it('is enforced, not report-only', () => {
    expect(appPolicy?.name).toBe('Content-Security-Policy');
    expect(conf).not.toContain('Content-Security-Policy-Report-Only');
  });

  it('still reports what it blocks', () => {
    expect(appPolicy?.value).toContain('report-uri /api/public/csp-report');
  });

  it('keeps the parts that must never loosen', () => {
    for (const part of [
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ]) {
      expect(appPolicy?.value).toContain(part);
    }
    expect(appPolicy?.value).not.toContain("'unsafe-eval'");
  });
});
