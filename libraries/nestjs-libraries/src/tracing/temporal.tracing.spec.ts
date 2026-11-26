import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace';
import { defaultPayloadConverter } from '@temporalio/common';
import { bundleWorkflowCode } from '@temporalio/worker';
import { initializeTracing, flushTracing, shutdownTracing, tracingPipeline } from './initialize.tracing';
import { temporalClientTracing, temporalWorkerTracing } from './temporal.tracing';
import { temporalWorkers } from '@gitroom/nestjs-libraries/temporal/temporal.module';

jest.setTimeout(120_000);

// What a workflow and its activities are given and return: never in a span.
const SECRETS = {
  content: 'the text of a post nobody else should read',
  token: 'platform-access-token-value',
  email: 'jane.doe@example.com',
  result: 'value-returned-by-the-activity',
};

const bundle = async () =>
  (
    await bundleWorkflowCode({
      workflowsPath: require.resolve('./tracing.fixture.workflow'),
      workflowInterceptorModules:
        temporalWorkerTracing(true).interceptors?.workflowModules ?? [],
      logger: { log: () => undefined, trace: () => undefined, debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    } as Parameters<typeof bundleWorkflowCode>[0])
  ).code;

const packageLoaded = () =>
  Object.keys(require.cache).some((file) =>
    file.includes('interceptors-opentelemetry')
  );

describe('without tracing', () => {
  it('gives a Temporal client and the workers nothing, and does not load the interceptors', () => {
    expect(tracingPipeline()).toBeNull();
    expect(temporalClientTracing()).toBeUndefined();
    expect(temporalWorkerTracing(true)).toEqual({});
    expect(temporalWorkerTracing(false)).toEqual({});
    for (const worker of temporalWorkers('/workflows', [])) {
      expect(worker.workerOptions).not.toHaveProperty('interceptors');
      expect(worker.workerOptions).not.toHaveProperty('sinks');
    }
    expect(packageLoaded()).toBe(false);
  });

  it('bundles no OpenTelemetry code into the workflow sandbox', async () => {
    const code = await bundle();
    expect(code.includes('fixtureWorkflow')).toBe(true);
    expect(code.includes('node_modules/@opentelemetry/')).toBe(false);
    expect(code.includes('interceptors-opentelemetry-v2/lib/')).toBe(false);
  });
});

describe('with tracing', () => {
  const exporter = new InMemorySpanExporter();
  const spans = async (): Promise<ReadableSpan[]> => {
    await flushTracing();
    return exporter.getFinishedSpans();
  };
  const everything = (list: ReadableSpan[]) =>
    JSON.stringify(
      list.map((span) => ({
        name: span.name,
        attributes: span.attributes,
        status: span.status,
        events: span.events,
      }))
    );
  const traceparent = (headers: Record<string, unknown>) => {
    const carrier = defaultPayloadConverter.fromPayload<Record<string, string>>(
      headers['_tracer-data'] as never
    );
    return carrier;
  };

  beforeAll(() => {
    process.env.OTEL_TRACES_ENDPOINT = 'http://127.0.0.1:9/v1/traces';
    expect(initializeTracing('orchestrator', { exporter })).toBe(true);
  });
  afterAll(async () => {
    await shutdownTracing();
    delete process.env.OTEL_TRACES_ENDPOINT;
  });
  beforeEach(() => exporter.reset());

  it('puts the workflow interceptors and the span sink on the worker that runs workflows only', () => {
    const workers = temporalWorkers('/workflows', []);
    const main = workers.find((worker) => worker.taskQueue === 'main')!;
    expect(main.workerOptions?.interceptors?.workflowModules).toEqual([
      require.resolve('@temporalio/interceptors-opentelemetry-v2/lib/workflow-interceptors'),
    ]);
    expect(main.workerOptions?.sinks).toHaveProperty('exporter');
    expect(main.workerOptions?.interceptors?.activity).toHaveLength(1);

    const others = workers.filter((worker) => worker.taskQueue !== 'main');
    expect(others.length).toBeGreaterThan(5);
    for (const worker of others) {
      expect(worker.workerOptions?.interceptors?.activity).toHaveLength(1);
      expect(worker.workerOptions?.interceptors).not.toHaveProperty('workflowModules');
      expect(worker.workerOptions).not.toHaveProperty('sinks');
    }
  });

  it('bundles the interceptors into the workflow sandbox', async () => {
    const code = await bundle();
    expect(code.includes('fixtureWorkflow')).toBe(true);
    expect(code.includes('node_modules/@opentelemetry/')).toBe(true);
    expect(code.includes('interceptors-opentelemetry-v2/lib/workflow-interceptors')).toBe(true);
    expect(packageLoaded()).toBe(true);
  });

  it('follows one trace from the request through the client call, the workflow and the activity to what the activity does', async () => {
    const tracer = trace.getTracer('spec');

    // The backend: a request starts the workflow. The caller's context also
    // carries baggage, which must stay behind.
    const [client] = temporalClientTracing()!.workflow as any[];
    const baggage = propagation.setBaggage(
      context.active(),
      propagation.createBaggage({ user: { value: SECRETS.email } })
    );
    const request = tracer.startSpan('POST /posts', {}, baggage);
    let started: Record<string, unknown> = {};
    await context.with(trace.setSpan(baggage, request), () =>
      client.start(
        {
          workflowType: 'postWorkflowV109',
          headers: {},
          options: { workflowId: 'post_42', args: [SECRETS] },
        },
        async (input: { headers: Record<string, unknown> }) => {
          started = input.headers;
          return 'run-1';
        }
      )
    );
    request.end();
    // The history keeps this header: the trace id and the parent span.
    expect(Object.keys(started)).toEqual(['_tracer-data']);
    expect(Object.keys(traceparent(started))).toEqual(['traceparent']);
    expect(traceparent(started).traceparent).toContain(request.spanContext().traceId);

    // The workflow sandbox hands its spans to the worker through the sink,
    // with the whole workflow info copied onto each.
    const [, , workflowParent] = traceparent(started).traceparent.split('-');
    const sink = temporalWorkerTracing(true).sinks!.exporter as any;
    const workflowSpan = {
      name: 'RunWorkflow:postWorkflowV109',
      kind: SpanKind.INTERNAL,
      spanContext: { traceId: request.spanContext().traceId, spanId: 'aaaaaaaaaaaaaaaa', traceFlags: 1 },
      parentSpanContext: { traceId: request.spanContext().traceId, spanId: workflowParent, traceFlags: 1 },
      startTime: [1, 0],
      endTime: [2, 0],
      duration: [1, 0],
      status: { code: SpanStatusCode.ERROR, message: `activity failed with ${SECRETS.token}` },
      attributes: {},
      links: [],
      events: [
        {
          name: 'exception',
          time: [2, 0],
          attributes: {
            'exception.type': 'ActivityFailure',
            'exception.message': `refused "${SECRETS.content}"`,
            'exception.stacktrace': `Error: refused "${SECRETS.content}"\n    at publish`,
          },
        },
      ],
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
      instrumentationScope: { name: '@temporalio/interceptor-workflow' },
    };
    sink.export.fn(
      {
        workflowId: 'post_42',
        runId: 'run-1',
        workflowType: 'postWorkflowV109',
        taskQueue: 'main',
        namespace: 'default',
        attempt: 1,
        memo: { note: SECRETS.content },
        searchAttributes: { organizationId: ['org-1'] },
        lastResult: SECRETS.result,
        lastFailure: { message: SECRETS.token },
        cronSchedule: SECRETS.token,
      },
      [workflowSpan]
    );

    // The worker: the activity runs under the context the workflow sent.
    const activityHeaders: Record<string, unknown> = {};
    propagation.inject(
      trace.setSpanContext(context.active(), {
        traceId: request.spanContext().traceId,
        spanId: 'bbbbbbbbbbbbbbbb',
        traceFlags: 1,
      }),
      activityHeaders
    );
    const { inbound } = (temporalWorkerTracing(false).interceptors!.activity![0] as any)({
      info: {
        activityType: 'postSocial',
        activityId: '7',
        inWorkflow: true,
        workflowExecution: { workflowId: 'post_42', runId: 'run-1' },
      },
    });
    const run = (next: () => Promise<unknown>) =>
      inbound.execute(
        {
          args: [SECRETS],
          headers: { '_tracer-data': defaultPayloadConverter.toPayload(activityHeaders) },
        },
        next
      );
    expect(
      await run(async () => {
        tracer.startSpan('call to the platform').end();
        return SECRETS.result;
      })
    ).toBe(SECRETS.result);
    await expect(
      run(async () => {
        throw new Error(`platform refused "${SECRETS.content}" for ${SECRETS.email}`);
      })
    ).rejects.toThrow('platform refused');

    const finished = await spans();
    const byName = (name: string) => finished.filter((span) => span.name === name);
    const [clientSpan] = byName('StartWorkflow:postWorkflowV109');
    const [workflow] = byName('RunWorkflow:postWorkflowV109');
    const [activity, failed] = byName('RunActivity:postSocial');
    const [inside] = byName('call to the platform');

    // One trace, each step under the one before.
    for (const span of [clientSpan, workflow, activity, failed, inside]) {
      expect(span.spanContext().traceId).toBe(request.spanContext().traceId);
    }
    expect(clientSpan.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(workflow.parentSpanContext?.spanId).toBe(clientSpan.spanContext().spanId);
    expect(activity.parentSpanContext?.spanId).toBe('bbbbbbbbbbbbbbbb');
    expect(inside.parentSpanContext?.spanId).toBe(activity.spanContext().spanId);

    // Which run and which step, and nothing they were given or returned.
    expect(clientSpan.attributes).toEqual({ temporalWorkflowId: 'post_42', run_id: 'run-1' });
    expect(workflow.attributes).toEqual({
      workflowId: 'post_42',
      runId: 'run-1',
      workflowType: 'postWorkflowV109',
      taskQueue: 'main',
      namespace: 'default',
      attempt: 1,
    });
    expect(workflow.resource).toBe(tracingPipeline()!.resource);
    expect(activity.attributes).toEqual({
      temporalActivityId: '7',
      temporalWorkflowId: 'post_42',
      run_id: 'run-1',
    });
    // A failure keeps its kind; the message and the stack stay out.
    expect(failed.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(failed.events.map((event) => event.attributes)).toEqual([{ 'exception.type': 'Error' }]);
    expect(workflow.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(workflow.events.map((event) => event.attributes)).toEqual([{ 'exception.type': 'ActivityFailure' }]);

    const text = everything(finished);
    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
  });
});
