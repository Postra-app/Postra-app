import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import {
  ExpressInstrumentation,
  ExpressLayerType,
} from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import {
  defaultResource,
  detectResources,
  envDetector,
  hostDetector,
  resourceFromAttributes,
  serviceInstanceIdDetector,
  type Resource,
} from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { ScrubbingSpanProcessor } from './scrub.span';

// Not in the stable set of @opentelemetry/semantic-conventions yet; its
// README says to copy such names instead of importing the unstable entry.
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = 'deployment.environment.name';

// Load balancer and deploy health checks and the Prometheus scrape: several
// requests a minute each, and none of them says anything about a user's
// request.
const UNTRACED_PATHS = [
  /\/monitor\/(live|queue\/[^/]+)$/,
  /\/health\/status$/,
  /^\/metrics$/,
];

/** True for a request path (query string allowed) that gets no trace. */
export const isUntracedPath = (url: string | undefined | null) => {
  const path = (url ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  return UNTRACED_PATHS.some((untraced) => untraced.test(path));
};

// Sentry reports errors over HTTPS from inside the process; a span for each
// report would be noise about our own tooling.
const sentryHost = () => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').hostname;
  } catch {
    return undefined;
  }
};

const hostname = (host: string | undefined | null) =>
  (host ?? '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/:\d+$/, '');

/** True for an outgoing request that gets no span. */
export const isUntracedOutgoing = (
  host: string | undefined | null,
  path: string | undefined | null
) => {
  const sentry = sentryHost();
  return (!!sentry && hostname(host) === sentry) || isUntracedPath(path);
};

/**
 * The environment the traces are labelled with. NODE_ENV says "production"
 * on every deployed stack, a staging one included, so a stack names itself
 * in OTEL_TRACES_ENVIRONMENT; without it the label is NODE_ENV.
 */
export const deploymentEnvironment = () =>
  process.env.OTEL_TRACES_ENVIRONMENT?.trim() ||
  process.env.NODE_ENV ||
  'development';

/**
 * Share of new traces to keep, from OTEL_TRACES_SAMPLE_RATIO: 1 keeps all
 * (the default, and the fallback for a value that is not a number from 0 to 1).
 */
export const sampleRatio = () => {
  const raw = process.env.OTEL_TRACES_SAMPLE_RATIO?.trim();
  const ratio = raw ? Number(raw) : 1;
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 1;
};

// The SDK reports an export error as the error object in JSON, stack included.
const errorText = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }
  try {
    const parsed = JSON.parse(String(value));
    return typeof parsed?.message === 'string' ? parsed.message : String(value);
  } catch {
    return String(value);
  }
};

// A collector that is down fails every export, every few seconds. One line a
// minute says so without filling the log.
const quietLogger = (intervalMs = 60_000): DiagLogger => {
  let last = 0;
  let skipped = 0;
  const report = (message: string, ...args: unknown[]) => {
    const now = Date.now();
    if (now - last < intervalMs) {
      skipped += 1;
      return;
    }
    console.warn(
      `Tracing: ${[message, ...args].map(errorText).join(' ')}` +
        (skipped ? ` (${skipped} more not shown)` : '')
    );
    last = now;
    skipped = 0;
  };
  const silent = (): undefined => undefined;
  return { error: report, warn: report, info: silent, debug: silent, verbose: silent };
};

const instrumentations = () => [
  // No `headersToSpanAttributes`: headers carry sessions and tokens.
  new HttpInstrumentation({
    ignoreIncomingRequestHook: (request) => isUntracedPath(request.url),
    ignoreOutgoingRequestHook: (request) =>
      isUntracedOutgoing(request.hostname ?? request.host, request.path),
  }),
  // One span per middleware fills a trace without saying where the time went.
  new ExpressInstrumentation({
    ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
  }),
  new NestInstrumentation(),
  // fetch and undici: the calls to social platforms and AI providers.
  new UndiciInstrumentation({
    ignoreRequestHook: (request) =>
      isUntracedOutgoing(request.origin, request.path),
  }),
  // The command name only: keys and values can be anything a user stored.
  // `requireParentSpan` stays at its default (true), so the clients' own
  // polling outside a request is not traced.
  new IORedisInstrumentation({
    dbStatementSerializer: (command) => command,
  }),
  // Prisma's internal steps; the operation, the engine query and the SQL
  // spans stay. The SQL has placeholders where the values go.
  new PrismaInstrumentation({
    ignoreSpanTypes: [
      /^prisma:(client:serialize|engine:(serialize|response_json_serialization|connection))$/,
    ],
  }),
];

export interface TracingOptions {
  serviceName: string;
  /** Full URL of the collector's OTLP/HTTP traces endpoint. */
  endpoint: string;
  /** Replaces the OTLP exporter; for tests. */
  exporter?: SpanExporter;
}

export interface TracingHandle {
  /**
   * Where a span made outside the tracer provider goes (the ones Temporal
   * workflows hand out of their sandbox): scrubbed, then batched and exported.
   */
  readonly processor: SpanProcessor;
  /** What every span of this process is labelled with. */
  readonly resource: Resource;
  /** Exports the finished spans still in the buffer. */
  forceFlush(): Promise<void>;
  /** Flushes and stops the SDK, and takes the instrumentation hooks off again. */
  shutdown(): Promise<void>;
}

export const startTracing = (options: TracingOptions): TracingHandle => {
  const version = process.env.NEXT_PUBLIC_VERSION;
  const exporter =
    options.exporter ?? new OTLPTraceExporter({ url: options.endpoint });
  // Batched and sent in the background: a request never waits for the
  // collector, and when it is down the buffer is capped and spans are dropped.
  const processor: SpanProcessor = new ScrubbingSpanProcessor(
    new BatchSpanProcessor({ exporter })
  );
  const active = instrumentations();
  const resource = defaultResource()
    .merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: deploymentEnvironment(),
        ...(version ? { [ATTR_SERVICE_VERSION]: version } : {}),
      })
    )
    // Which host and which process, plus what OTEL_RESOURCE_ATTRIBUTES adds.
    // The SDK's default set also reports the command line and the user the
    // process runs as, which a trace has no use for.
    .merge(
      detectResources({
        detectors: [serviceInstanceIdDetector, hostDetector, envDetector],
      })
    );
  const sdk = new NodeSDK({
    // Complete as it is: the workflow spans need the same resource, and the
    // SDK keeps the one it would detect to itself.
    resource,
    autoDetectResources: false,
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(sampleRatio()),
    }),
    // The trace id and the parent span, nothing else. The SDK's default also
    // forwards `baggage`: whatever a caller put in that header would go out
    // again with every request to a platform and into workflow histories.
    textMapPropagator: new W3CTraceContextPropagator(),
    spanProcessors: [processor],
    instrumentations: active,
    // Traces only. Left out, the SDK would also start OTLP exporters for
    // logs and metrics from its environment defaults.
    logRecordProcessors: [],
    metricReaders: [],
  });
  diag.setLogger(quietLogger(), {
    logLevel: DiagLogLevel.WARN,
    suppressOverrideMessage: true,
  });
  sdk.start();
  return {
    processor,
    resource,
    forceFlush: () => processor.forceFlush(),
    shutdown: async () => {
      for (const instrumentation of active) {
        instrumentation.disable();
      }
      await sdk.shutdown();
    },
  };
};
