jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(async () => '381') },
}));

import { register } from 'prom-client';
import { LINKEDIN_PAGE_CALLS_METRIC } from '@gitroom/nestjs-libraries/integrations/linkedin-pages.usage';
import './metrics';

// The scrape reports the shared Redis count, which the 75 % alert reads.
it('reports today’s LinkedIn Pages API calls on /metrics', async () => {
  const text = await register.getSingleMetricAsString(LINKEDIN_PAGE_CALLS_METRIC);
  expect(text).toContain(`${LINKEDIN_PAGE_CALLS_METRIC} 381`);
});
