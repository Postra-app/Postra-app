import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { capitalize } from 'lodash';
import { isClientAbort } from './client.abort';
import { isClientRequestError } from './client.request.error';
import { SENTRY_DATA_COLLECTION } from '@gitroom/helpers/utils/sentry.data.collection';

// Sentry 11 names spans differently: a database span by its SQL summary
// (first keyword: `DEALLOCATE`, not `DEALLOCATE ALL`) and Express middleware
// with op `middleware` plus the Express origin.
export const SENTRY_IGNORED_SPANS = [
  /^prisma:(client:serialize|engine:(query|serialize|response_json_serialization|connection))$/,
  { op: 'db', name: /^(BEGIN|COMMIT|DEALLOCATE( ALL)?)$/ },
  { op: 'middleware', attributes: { 'sentry.origin': 'auto.http.express' } },
];

export const initializeSentry = (appName: string, allowLogs = false) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return null;
  }

  // Sample rate: full traces in dev, 10% in prod (100% burns the Sentry quota and
  // adds per-request overhead). Override via SENTRY_TRACES_SAMPLE_RATE (SSM) without redeploy.
  const prodTracesDefault =
    process.env.NODE_ENV === 'production' ? 0.1 : 1.0;
  const tracesSampleRate = process.env.SENTRY_TRACES_SAMPLE_RATE
    ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : prodTracesDefault;

  try {
    Sentry.init({
      initialScope: {
        tags: {
          service: appName,
          component: 'nestjs',
        },
        // Spans stream in Sentry 11 and no longer carry the scope's tags;
        // attributes keep backend and orchestrator apart there (one DSN).
        attributes: {
          service: appName,
          component: 'nestjs',
        },
        contexts: {
          app: {
            name: `Postra ${capitalize(appName)}`,
          },
        },
      },
      dataCollection: SENTRY_DATA_COLLECTION,
      environment: process.env.NODE_ENV || 'development',
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      spotlight: process.env.SENTRY_SPOTLIGHT === '1',
      integrations: [
        // Add our Profiling integration
        nodeProfilingIntegration(),
        Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
        Sentry.openAIIntegration({
          // GDPR: prompts/completions contain user content (post drafts, brand
          // details) — keep them out of Sentry, timing/token metrics still flow.
          recordInputs: false,
          recordOutputs: false,
        }),
      ],
      // A client hanging up mid-upload, or sending a body body-parser
      // refuses, is not a server error (see isClientAbort and
      // isClientRequestError).
      beforeSend: (event, hint) =>
        isClientAbort(event) || isClientRequestError(hint?.originalException) ? null : event,
      tracesSampleRate,
      // Noise that fills traces and the free quota without telling anything
      // (upstream 2ffd05fc4): Prisma's internal steps, transaction
      // bookkeeping and one span per Express middleware.
      ignoreSpans: SENTRY_IGNORED_SPANS,
      // Logs: consoleLoggingIntegration above sends warn and error (Sentry
      // 11 dropped `enableLogs`).

      // Profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
      profileLifecycle: 'trace',
    });
  } catch (err) {
    // Runs before Nest is loaded; importing @nestjs/common here would defeat
    // Sentry's instrumentation of it.
    console.error(`Sentry init failed: ${(err as Error)?.message ?? err}`);
  }
  return true;
};
