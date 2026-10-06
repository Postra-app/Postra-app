import { readFileSync } from 'fs';
import { join } from 'path';

// nginx in the app container must proxy to 127.0.0.1, not "localhost".
// localhost resolves to 127.0.0.1 and ::1, nginx turns that into a group of
// two servers and marks both down for 10 s after failed connects, so it keeps
// answering 502 for up to 10 s after the backend is already up. That is what
// failed the deploy smoke on 2026-10-05 and 2026-10-06 (see the comment in
// var/docker/nginx.conf). Measured with the real config in Docker: 25 of 39
// /api requests failed after the backend started with localhost, 0 of 40
// with 127.0.0.1.

const conf = readFileSync(
  join(__dirname, '..', '..', '..', 'var', 'docker', 'nginx.conf'),
  'utf8'
);
const targets = [...conf.matchAll(/^\s*proxy_pass\s+([^;]+);/gm)].map(
  (m) => m[1]
);

describe('var/docker/nginx.conf upstreams', () => {
  it('has proxy_pass targets to check', () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  it.each(targets)('%s points at a single address', (target) => {
    expect(target).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  });
});
