import { readFileSync } from 'fs';
import { join } from 'path';

// nginx answers a request for /api (no trailing slash) with its own 301 to
// /api/ (nginx docs, "location": a prefix location ending in a slash with
// proxy_pass redirects the slash-less URI). With the defaults that Location
// was absolute and carried the listen port: http://app.postra.co.uk:5000/api/,
// plain http and the container port, from behind an HTTPS balancer
// (measured on production 2026-10-22). The Server header also
// carried the nginx version. Relative redirects and no version, in the one
// server block.

const conf = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'var', 'docker', 'nginx.conf'),
  'utf8'
);
const serverBlock = conf.slice(conf.indexOf('server {'));

describe('var/docker/nginx.conf redirects and version', () => {
  it.each([
    'absolute_redirect off;',
    'port_in_redirect off;',
    'server_tokens off;',
  ])('server block sets %s', (directive) => {
    expect(serverBlock).toContain(directive);
  });
});
