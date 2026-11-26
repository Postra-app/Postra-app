// Request traces over OTLP, switched on by OTEL_TRACES_ENDPOINT. This file
// stays small on purpose: without the setting the process does not load the
// OpenTelemetry SDK at all and starts exactly as it does without tracing.
import type { TracingHandle, TracingOptions } from './start.tracing';

let handle: TracingHandle | null = null;

/** True once this process exports traces through its own OpenTelemetry SDK. */
export const tracingStarted = () => handle !== null;

/**
 * Starts tracing when OTEL_TRACES_ENDPOINT is set. Call it before anything
 * else is imported, Sentry included: a library loaded earlier is not
 * instrumented, and Sentry has to find the tracer provider already
 * registered. `overrides` is for tests.
 */
export const initializeTracing = (
  appName: string,
  overrides: Pick<TracingOptions, 'exporter'> = {}
) => {
  const endpoint = process.env.OTEL_TRACES_ENDPOINT?.trim();
  if (!endpoint || handle) {
    return tracingStarted();
  }
  try {
    // A static import would load the SDK in every process.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startTracing } = require('./start.tracing') as typeof import('./start.tracing');
    handle = startTracing({
      serviceName: `postra-${appName}`,
      endpoint,
      ...overrides,
    });
  } catch (err) {
    // Tracing must never stop the app from starting.
    console.error(`Tracing init failed: ${(err as Error)?.message ?? err}`);
  }
  return tracingStarted();
};

/** Sends the finished spans still in the buffer; tracing goes on. */
export const flushTracing = async () => {
  await handle?.forceFlush().catch((): undefined => undefined);
};

/**
 * Sends the spans still in the buffer and stops the SDK. Waits no longer
 * than `timeoutMs`, so a collector that does not answer cannot hold up the
 * process exit.
 */
export const shutdownTracing = async (timeoutMs = 3000) => {
  const current = handle;
  if (!current) {
    return;
  }
  handle = null;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    current.shutdown().catch((): undefined => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
};
