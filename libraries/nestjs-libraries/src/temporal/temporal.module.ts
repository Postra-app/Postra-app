import { TemporalModule, WorkerDefinition } from 'nestjs-temporal-core';
import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';

// One worker per task queue: 'main' plus one per provider.
export const temporalWorkers = (
  path: string,
  activityClasses: any[]
): WorkerDefinition[] =>
  [
    { identifier: 'main', maxConcurrentJob: undefined },
    ...socialIntegrationList,
  ]
    .filter((f) => f.identifier.indexOf('-') === -1)
    .map((integration) => ({
      taskQueue: integration.identifier.split('-')[0],
      // Every workflow starts on 'main' (startChild inherits it); the provider
      // queues only ever run activities (proxyActivities in post.workflow). A
      // worker given workflowsPath bundles the workflows itself and keeps its
      // own workflow thread, so ~25 provider workers held ~25 copies: 1.6 GB
      // RSS for the orchestrator. Activity-only workers for them.
      ...(integration.identifier === 'main' ? { workflowsPath: path } : {}),
      activityClasses,
      autoStart: true,
      workerOptions: {
        // markPublishing (temporal.heartbeat.ts) must reach the server
        // within a second; the 60 s default could hold it back long
        // enough for a dying worker to take it along.
        maxHeartbeatThrottleInterval: '1 second',
        ...(integration.maxConcurrentJob
          ? {
              maxConcurrentActivityTaskExecutions:
                integration.maxConcurrentJob,
            }
          : {}),
      },
    }));

export const getTemporalModule = (
  isWorkers: boolean,
  path?: string,
  activityClasses?: any[]
) => {
  return TemporalModule.register({
    isGlobal: true,
    connection: {
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      ...process.env.TEMPORAL_TLS === 'true' ? {tls: true} : {},
      ...process.env.TEMPORAL_API_KEY ? {apiKey: process.env.TEMPORAL_API_KEY} : {},
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    },
    taskQueue: 'main',
    logLevel: 'error',
    ...(isWorkers
      ? { workers: temporalWorkers(path!, activityClasses!) }
      : {}),
  });
};
