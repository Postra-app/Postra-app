import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { capitalize } from 'lodash';
import { isClientAbort } from './client.abort';

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
        contexts: {
          app: {
            name: `Postra ${capitalize(appName)}`,
          },
        },
      },
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
      // A client hanging up mid-upload is not a server error (see isClientAbort).
      beforeSend: (event) => (isClientAbort(event) ? null : event),
      tracesSampleRate,
      enableLogs: true,

      // Profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
      profileLifecycle: 'trace',
    });
  } catch (err) {
    console.log(err);
  }
  return true;
};
