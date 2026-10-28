import { readFileSync } from 'fs';
import { join } from 'path';

// The app's Content-Security-Policy is enforced (2026-10-15) after it ran
// report-only from 2026-10-09: no report in the logs since the deploy of
// 2026-10-13, and a click-through of calendar, composer, media library, Studio
// (templates, Pixabay, Unsplash), agent, analytics, Auto Post, plugs, settings,
// billing and admin sent none either, while a test frame to an unknown host was
// reported. Reports keep going to /api/public/csp-report.

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

  // Admin → Dashboards embeds the status page; a click-through missed that
  // screen (report: frame-src blocked=https://status.postra.pl/). The status
  // page moved to status.postra.co.uk on 2026-10-27; the old name no longer
  // serves it.
  it('lets the admin dashboards frame the status page', () => {
    expect(appPolicy?.value).toMatch(/frame-src [^;]*https:\/\/status\.postra\.co\.uk/);
    expect(appPolicy?.value).not.toContain('status.postra.pl');
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

// There was no Permissions-Policy anywhere, so any script on the page
// - our own, Stripe's, Plausible's, or one that got in - could ask for the
// camera, the microphone or the location. Postra uses none of them.
describe('var/docker/nginx.conf Permissions-Policy', () => {
  const policy = conf.match(/add_header\s+Permissions-Policy\s+"([^"]+)"\s+always;/)?.[1];

  it('turns off the device features the app never uses', () => {
    for (const feature of ['camera', 'microphone', 'geolocation', 'usb']) {
      expect(policy).toMatch(new RegExp(`${feature}=\\(\\)`));
    }
  });

  it('is sent beside the other security headers of the server block', () => {
    const block = conf.slice(conf.indexOf('add_header X-Frame-Options'));
    expect(block.indexOf('Permissions-Policy')).toBeLessThan(block.indexOf('location '));
  });
});
