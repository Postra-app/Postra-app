import { readFileSync } from 'fs';
import { join } from 'path';

// The load balancer in front reuses an idle connection for up to 180 s.
// nginx's default keepalive_timeout (75 s) closed it first, so a request sent
// down a connection nginx had just closed came back as a 502. The target must
// keep idle connections open longer than the balancer.
it('nginx keeps idle connections open longer than the load balancer (180 s)', () => {
  const conf = readFileSync(
    join(__dirname, '..', '..', '..', 'var', 'docker', 'nginx.conf'),
    'utf8'
  );
  const match = conf.match(/^\s*keepalive_timeout\s+(\d+)s?\s*;/m);
  expect(match).not.toBeNull();
  expect(Number(match![1])).toBeGreaterThan(180);
});
