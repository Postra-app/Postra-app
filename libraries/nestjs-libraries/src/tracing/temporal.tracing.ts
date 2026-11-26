// Temporal's side of a trace: the client call that starts or signals a
// workflow, the workflow run and each activity join the trace of the request
// that caused them. Everything here is empty unless tracing runs
// (OTEL_TRACES_ENDPOINT), and the interceptor package is loaded only then:
// without it the worker and its workflow bundle are what they were.
import type { ClientInterceptors } from '@temporalio/client';
import type { WorkerOptions } from '@temporalio/worker';
import { tracingPipeline } from './initialize.tracing';

type Interceptors = typeof import('@temporalio/interceptors-opentelemetry-v2');

// The package's own module for the workflow sandbox: the one its plugin
// registers.
const WORKFLOW_INTERCEPTORS =
  '@temporalio/interceptors-opentelemetry-v2/lib/workflow-interceptors';

const load = (): Interceptors =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@temporalio/interceptors-opentelemetry-v2');

/** Interceptors for a Temporal client: a span per call, its context in the workflow's headers. */
export const temporalClientTracing = (): ClientInterceptors | undefined => {
  if (!tracingPipeline()) {
    return undefined;
  }
  const { OpenTelemetryWorkflowClientInterceptor } = load();
  return { workflow: [new OpenTelemetryWorkflowClientInterceptor()] };
};

/**
 * Worker options that continue a trace through activities and, on a worker
 * that runs workflows, through the workflows: their interceptors are bundled
 * into the sandbox and their spans leave it through the `exporter` sink.
 */
export const temporalWorkerTracing = (
  runsWorkflows: boolean
): Pick<WorkerOptions, 'interceptors' | 'sinks'> => {
  const pipeline = tracingPipeline();
  if (!pipeline) {
    return {};
  }
  const {
    OpenTelemetryActivityInboundInterceptor,
    OpenTelemetryActivityOutboundInterceptor,
    makeWorkflowExporter,
  } = load();
  return {
    interceptors: {
      activity: [
        (context) => ({
          inbound: new OpenTelemetryActivityInboundInterceptor(context),
          outbound: new OpenTelemetryActivityOutboundInterceptor(context),
        }),
      ],
      ...(runsWorkflows
        ? { workflowModules: [require.resolve(WORKFLOW_INTERCEPTORS)] }
        : {}),
    },
    ...(runsWorkflows
      ? {
          sinks: {
            exporter: makeWorkflowExporter(
              pipeline.processor,
              pipeline.resource
            ),
          },
        }
      : {}),
  };
};
