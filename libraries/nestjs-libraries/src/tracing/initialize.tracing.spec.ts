import { SpanKind } from '@opentelemetry/api';
import {
  closedAddress,
  listen,
  listenRedis,
  SECRETS,
  startFixture,
  type Fixture,
  type FixtureSpan,
} from './tracing.spec.helpers';

jest.setTimeout(30_000);

const request = (fixture: Fixture, path: string, headers: Record<string, string> = {}) =>
  fetch(`${fixture.url}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SECRETS.bearer}`,
      cookie: `auth=${SECRETS.cookie}`,
      'x-forwarded-for': SECRETS.clientIp,
      baggage: `user=${SECRETS.baggage}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ content: SECRETS.body, email: SECRETS.email }),
  });

const serverSpan = (spans: FixtureSpan[]) =>
  spans.find((span) => span.kind === SpanKind.SERVER);

describe('without OTEL_TRACES_ENDPOINT', () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await startFixture({});
  });
  afterAll(() => fixture.kill());

  it('starts nothing and does not load the SDK', async () => {
    expect(fixture.started).toBe(false);
    expect(fixture.sdkLoaded).toBe(false);
    expect(fixture.recording).toBe(false);

    expect((await fetch(`${fixture.url}/other`)).status).toBe(200);
    expect(await fixture.spans()).toEqual([]);
  });
});

describe('with OTEL_TRACES_ENDPOINT', () => {
  let platform: Awaited<ReturnType<typeof listen>>;
  let redis: Awaited<ReturnType<typeof listenRedis>>;
  let fixture: Fixture;

  beforeAll(async () => {
    platform = await listen({ id: 'created' });
    redis = await listenRedis();
    fixture = await startFixture(
      {
        OTEL_TRACES_ENDPOINT: `http://${await closedAddress()}/v1/traces`,
        NEXT_PUBLIC_VERSION: 'abc1234',
      },
      {
        exporter: 'memory',
        platformUrl: platform.url,
        redisAddress: redis.address,
        closedAddress: await closedAddress(),
      }
    );
  });
  afterAll(async () => {
    await fixture.kill();
    await platform.close();
    await redis.close();
  });

  it('starts tracing', () => {
    expect(fixture.started).toBe(true);
    expect(fixture.recording).toBe(true);
  });

  it('records a request with its platform call, Redis command and database query as one trace', async () => {
    const response = await request(fixture, `/posts/42?token=${SECRETS.queryToken}`);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: '42',
      platform: { id: 'created' },
      content: SECRETS.body,
    });

    const spans = await fixture.spans();
    const server = serverSpan(spans)!;
    expect(server).toBeDefined();
    expect(server.name).toBe('POST /posts/:id');
    expect(server.attributes['http.route']).toBe('/posts/:id');
    expect(server.attributes['http.response.status_code']).toBe(201);
    expect(server.resource).toMatchObject({
      'service.name': 'postra-backend',
      'service.version': 'abc1234',
      'deployment.environment.name': 'test',
    });
    expect(Object.keys(server.resource).join()).not.toMatch(/process\.|os\./);
    // Not the caller's address either.
    expect(Object.keys(server.attributes).join()).not.toMatch(/peer|client/);

    const inTrace = spans.filter((span) => span.traceId === server.traceId);
    const below = (parent: FixtureSpan): FixtureSpan[] =>
      inTrace
        .filter((span) => span.parentSpanId === parent.spanId)
        .flatMap((span) => [span, ...below(span)]);
    const children = below(server);

    const call = children.find((span) => span.scope.includes('undici'))!;
    expect(call).toBeDefined();
    expect(call.kind).toBe(SpanKind.CLIENT);
    expect(call.attributes['http.request.method']).toBe('POST');
    expect(call.attributes['http.response.status_code']).toBe(200);
    // Scheme, host and path; the key in the path and the query string are gone.
    expect(call.attributes['url.full']).toBe(`${platform.url}/[redacted]/media`);

    const command = children.find(
      (span) => span.scope.includes('ioredis') && span.name === 'set'
    )!;
    expect(command).toBeDefined();
    // The command name, without the key and the value Redis received.
    expect(command.attributes['db.query.text']).toBe('set');
    expect(redis.commands).toContainEqual(['set', `session:${SECRETS.email}`, SECRETS.redisValue]);

    expect(children.some((span) => span.scope.includes('nestjs'))).toBe(true);

    const query = children.find((span) => span.name === 'prisma:client:operation');
    expect(query).toBeDefined();
    // Express middleware (the JSON body parser here) gets no span of its own.
    expect(children.some((span) => span.attributes['express.type'] === 'middleware')).toBe(false);
  });

  it('keeps headers, bodies, query strings, statement values and e-mail addresses out of the spans', async () => {
    await request(fixture, `/posts/42?token=${SECRETS.queryToken}&email=${SECRETS.email}`);
    await fetch(`${fixture.url}/fails?token=${SECRETS.queryToken}`);
    // The other side did receive all of it; only the trace must not.
    expect(platform.received.at(-1)!.headers.authorization).toContain(SECRETS.outgoingBearer);
    expect(platform.received.at(-1)!.url).toContain(SECRETS.outgoingToken);
    expect(platform.received.at(-1)!.body.toString()).toContain(SECRETS.outgoingBody);
    // The call carries the trace on, and not the baggage our caller sent.
    expect(platform.received.at(-1)!.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(platform.received.at(-1)!.headers).not.toHaveProperty('baggage');

    const spans = await fixture.spans();
    expect(spans.filter((span) => span.kind === SpanKind.SERVER)).toHaveLength(2);
    expect(spans.some((span) => span.events.some((event) => event.name === 'exception'))).toBe(true);

    const text = JSON.stringify(spans);
    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(encodeURIComponent(secret));
    }
    expect(text).not.toMatch(/authorization|cookie|access_token|bearer/i);
    for (const span of spans) {
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(key).not.toMatch(/header|body|query(?!\.text)|client\.address|user_agent/);
        expect(String(value)).not.toMatch(/\?|[^\s@]@[^\s@]+\.[a-z]{2,}/i);
      }
    }
  });

  it('records nothing for health checks and the metrics scrape', async () => {
    for (const path of [
      '/monitor/live',
      '/monitor/queue/post',
      '/health/status',
      '/metrics',
    ]) {
      expect((await fetch(`${fixture.url}${path}`)).status).toBe(200);
    }
    expect(await fixture.spans()).toEqual([]);

    // The same server is traced on any other path.
    await fetch(`${fixture.url}/other`);
    expect(serverSpan(await fixture.spans())?.attributes['http.route']).toBe('/other');
  });
});

describe('sampling', () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await startFixture(
      {
        OTEL_TRACES_ENDPOINT: `http://${await closedAddress()}/v1/traces`,
        OTEL_TRACES_SAMPLE_RATIO: '0',
      },
      { exporter: 'memory' }
    );
  });
  afterAll(() => fixture.kill());

  it('keeps the share of new traces set in OTEL_TRACES_SAMPLE_RATIO and follows a caller that sampled', async () => {
    await fetch(`${fixture.url}/other`);
    expect(await fixture.spans()).toEqual([]);

    const traceId = '0af7651916cd43dd8448eb211c80319c';
    await fetch(`${fixture.url}/other`, {
      headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
    });
    const server = serverSpan(await fixture.spans());
    expect(server?.traceId).toBe(traceId);
    expect(server?.parentSpanId).toBe('b7ad6b7169203331');
  });
});

describe('export to a collector', () => {
  it('posts protobuf to the URL in OTEL_TRACES_ENDPOINT and flushes on shutdown', async () => {
    const platform = await listen({ id: 'created' });
    const collector = await listen();
    const fixture = await startFixture(
      { OTEL_TRACES_ENDPOINT: `${collector.url}/v1/traces` },
      { platformUrl: platform.url, closedAddress: await closedAddress() }
    );
    await request(fixture, `/posts/42?token=${SECRETS.queryToken}`);
    // Well inside the batch interval of five seconds: only the shutdown sends it.
    expect(collector.received).toEqual([]);
    const { ms, code } = await fixture.shutdown();
    expect(code).toBe(0);
    expect(ms).toBeLessThan(3000);

    expect(collector.received).toHaveLength(1);
    const [sent] = collector.received;
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe('/v1/traces');
    expect(sent.headers['content-type']).toBe('application/x-protobuf');
    // Protobuf carries strings as they are.
    expect(sent.body.includes('postra-backend')).toBe(true);
    expect(sent.body.includes('POST /posts/:id')).toBe(true);
    for (const secret of Object.values(SECRETS)) {
      expect(sent.body.includes(secret)).toBe(false);
    }
    // The export itself is not traced.
    expect(sent.body.includes('/v1/traces')).toBe(false);
    await platform.close();
    await collector.close();
  });

  it('serves requests and exits on time when the collector is unreachable', async () => {
    const platform = await listen({ id: 'created' });
    const fixture = await startFixture(
      { OTEL_TRACES_ENDPOINT: `http://${await closedAddress()}/v1/traces` },
      { platformUrl: platform.url, closedAddress: await closedAddress() }
    );
    const startedAt = Date.now();
    for (let i = 0; i < 5; i++) {
      expect((await request(fixture, '/posts/42')).status).toBe(201);
    }
    expect(Date.now() - startedAt).toBeLessThan(5000);

    // The exporter retries a failed batch for up to ten seconds; the shutdown
    // gives up after the time it was given.
    const { ms, code } = await fixture.shutdown(500);
    expect(code).toBe(0);
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(2000);
    await platform.close();
  });
});
