import * as Sentry from '@sentry/nestjs';
import { trace } from '@opentelemetry/api';
import { initializeSentry, SENTRY_IGNORED_SPANS } from './initialize.sentry';
import {
  initializeTracing,
  shutdownTracing,
} from '@gitroom/nestjs-libraries/tracing/initialize.tracing';
import { SENTRY_DATA_COLLECTION } from '@gitroom/helpers/utils/sentry.data.collection';

// The real tracing setup, with the spans kept in memory instead of sent.
jest.mock('@gitroom/nestjs-libraries/tracing/start.tracing', () => {
  const actual = jest.requireActual('@gitroom/nestjs-libraries/tracing/start.tracing');
  const { InMemorySpanExporter } = jest.requireActual('@opentelemetry/sdk-trace');
  return {
    ...actual,
    startTracing: (options: object) =>
      actual.startTracing({ ...options, exporter: new InMemorySpanExporter() }),
  };
});

const options = () => Sentry.getClient()!.getOptions() as Record<string, any>;
const integrations = () =>
  (options().integrations as { name: string }[]).map((integration) => integration.name);

describe('Sentry and our own tracing', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@127.0.0.1:9/1';
  });
  afterAll(async () => {
    await shutdownTracing();
    delete process.env.OTEL_TRACES_ENDPOINT;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  });

  it('traces by itself, as before, without OTEL_TRACES_ENDPOINT', () => {
    delete process.env.OTEL_TRACES_ENDPOINT;
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
    expect(initializeTracing('backend')).toBe(false);
    expect(initializeSentry('backend')).toBe(true);

    expect(options().tracesSampleRate).toBe(0.25);
    expect(options().ignoreSpans).toBe(SENTRY_IGNORED_SPANS);
    expect(options().profileLifecycle).toBe('trace');
    expect(options().profileSessionSampleRate).toBe(0.1);
    expect(options().dataCollection).toEqual(SENTRY_DATA_COLLECTION);
    expect(integrations()).toContain('ProfilingIntegration');
    expect(integrations()).not.toContain('OpenTelemetry');
    // No tracer provider of ours either.
    expect(trace.getTracer('spec').startSpan('probe').isRecording()).toBe(false);
  });

  it('leaves tracing to OpenTelemetry with OTEL_TRACES_ENDPOINT, and links errors to its trace', async () => {
    await Sentry.close();
    process.env.OTEL_TRACES_ENDPOINT = 'http://127.0.0.1:9/v1/traces';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
    expect(initializeTracing('backend')).toBe(true);
    expect(initializeSentry('backend')).toBe(true);

    // The setup Sentry documents for an OpenTelemetry pipeline of one's own.
    expect(options().enableOpenTelemetrySetup).toBe(false);
    expect(options().tracesSampleRate).toBeUndefined();
    expect(options().tracesSampler).toBeUndefined();
    expect(integrations()).toContain('OpenTelemetry');
    expect(integrations()).not.toContain('ProfilingIntegration');
    expect(options()).not.toHaveProperty('ignoreSpans');
    expect(options()).not.toHaveProperty('profileLifecycle');
    // What Sentry may collect does not change with the mode.
    expect(options().dataCollection).toEqual(SENTRY_DATA_COLLECTION);

    // Sentry registered no provider of its own over ours, and an error
    // caught inside a span carries that span's trace.
    let event: Sentry.Event | undefined;
    Sentry.getClient()!.on('beforeSendEvent', (sent) => {
      event = sent;
    });
    const span = trace.getTracer('spec').startActiveSpan('request', (active) => {
      Sentry.captureException(new Error('failed inside a traced request'));
      active.end();
      return active;
    });
    expect(span.isRecording()).toBe(false);
    await Sentry.flush(1000);

    expect(event?.exception?.values?.[0].value).toBe('failed inside a traced request');
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(event?.contexts?.trace?.trace_id).toBe(span.spanContext().traceId);
    expect(event?.contexts?.trace?.span_id).toBe(span.spanContext().spanId);
  });
});
