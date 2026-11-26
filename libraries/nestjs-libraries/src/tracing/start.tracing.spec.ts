import {
  deploymentEnvironment,
  isUntracedOutgoing,
  isUntracedPath,
  sampleRatio,
} from './start.tracing';

describe('isUntracedPath', () => {
  it('matches the health checks and the metrics scrape, whatever comes in front or after', () => {
    for (const url of [
      '/monitor/live',
      '/api/monitor/live',
      '/monitor/live/',
      '/monitor/live?probe=1',
      '/monitor/queue/post',
      '/health/status',
      '/metrics',
    ]) {
      expect(isUntracedPath(url)).toBe(true);
    }
  });

  it('leaves every other request traced', () => {
    for (const url of ['/', '/posts', '/monitor', '/monitor/queue', '/monitor/live/extra', '/analytics/metrics', undefined]) {
      expect(isUntracedPath(url)).toBe(false);
    }
  });
});

describe('isUntracedOutgoing', () => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  afterEach(() => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
    if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it('skips reports to Sentry and scrapes of another instance', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@o1.ingest.sentry.example/1';
    expect(isUntracedOutgoing('o1.ingest.sentry.example', '/api/1/envelope/')).toBe(true);
    expect(isUntracedOutgoing('https://o1.ingest.sentry.example:443', '/api/1/envelope/')).toBe(true);
    expect(isUntracedOutgoing('127.0.0.1:9465', '/metrics')).toBe(true);
    expect(isUntracedOutgoing('api.example.com', '/v1/posts')).toBe(false);
  });

  it('traces everything else when there is no Sentry DSN', () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    expect(isUntracedOutgoing('', '/v1/posts')).toBe(false);
    expect(isUntracedOutgoing(undefined, undefined)).toBe(false);
  });
});

describe('sampleRatio', () => {
  afterEach(() => delete process.env.OTEL_TRACES_SAMPLE_RATIO);

  it('keeps every trace unless OTEL_TRACES_SAMPLE_RATIO says otherwise', () => {
    expect(sampleRatio()).toBe(1);
    process.env.OTEL_TRACES_SAMPLE_RATIO = '0.25';
    expect(sampleRatio()).toBe(0.25);
    process.env.OTEL_TRACES_SAMPLE_RATIO = '0';
    expect(sampleRatio()).toBe(0);
  });

  it('falls back to every trace for a value that is not a share', () => {
    for (const value of ['many', '-1', '2', ' ']) {
      process.env.OTEL_TRACES_SAMPLE_RATIO = value;
      expect(sampleRatio()).toBe(1);
    }
  });
});

describe('deploymentEnvironment', () => {
  const nodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    delete process.env.OTEL_TRACES_ENVIRONMENT;
    process.env.NODE_ENV = nodeEnv;
  });

  it('is the name the stack gives itself, so staging is told apart from production', () => {
    process.env.NODE_ENV = 'production';
    process.env.OTEL_TRACES_ENVIRONMENT = 'staging';
    expect(deploymentEnvironment()).toBe('staging');
  });

  it('falls back to NODE_ENV', () => {
    process.env.NODE_ENV = 'production';
    expect(deploymentEnvironment()).toBe('production');
    process.env.OTEL_TRACES_ENVIRONMENT = ' ';
    expect(deploymentEnvironment()).toBe('production');
  });
});
