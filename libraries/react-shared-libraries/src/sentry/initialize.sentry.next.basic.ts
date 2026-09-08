import * as Sentry from '@sentry/nextjs';
import { NETWORK_FAILURE_PATTERNS } from '@gitroom/helpers/utils/fetch.errors';

export const initializeSentryBasic = (environment: string, dsn: string, extension: any) => {
  if (!dsn) {
    return;
  }

  // One list, shared with the client code that decides whether to blame the
  // connection instead of the app — the two must not drift apart.
  const ignorePatterns = NETWORK_FAILURE_PATTERNS;

  // Sample rate: full traces in dev, 10% in prod (100% + session replays burns the
  // Sentry quota). Override via NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE (build-time).
  const prodTracesDefault = environment === 'production' ? 0.1 : 1.0;
  const tracesSampleRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
    ? parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
    : prodTracesDefault;

  try {
    Sentry.init({
      initialScope: {
        tags: {
          service: 'frontend',
          component: 'nextjs',
          replaysEnabled: 'true',
        },
        contexts: {
          app: {
            name: 'Postra Frontend',
            version: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
          },
        },
      },
      integrations: [
        Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
      ],
      environment: environment || 'development',
      // Without a release the uploaded source maps have nothing to attach to,
      // and every frontend stack trace in Sentry stays minified. This is the
      // same value the build stamps the maps with - see next.config.js.
      release: process.env.NEXT_PUBLIC_VERSION || undefined,
      spotlight: process.env.SENTRY_SPOTLIGHT === '1',
      dsn,
      // GDPR: never attach IP address / user identifiers by default.
      sendDefaultPii: false,
      ...extension,
      debug: environment === 'development',
      tracesSampleRate,

      beforeSend(event, hint) {
        if (event.exception && event.exception.values) {
          for (const exception of event.exception.values) {
            // customFetch rejects with FetchHandledError when the response was
            // already handled globally (402 payment dialog, trial gate) — an
            // expected business answer, not a crash. Sentry's own
            // unhandledrejection hook still captures it (our logger's
            // preventDefault doesn't stop other listeners), so drop it here
            // before it burns the event quota.
            if (exception.type === 'FetchHandledError') {
              return null;
            }
            if (exception.value) {
              for (const pattern of ignorePatterns) {
                if (pattern.test(exception.value)) {
                  return null; // Ignore the event
                }
              }
            }
          }
        }
        // No report dialog here: popping it on every captured exception (including
        // handled background ones) spams the user. global-error.tsx shows it for
        // hard crashes and the feedback icon covers user-initiated reports.

        return event; // Send the event to Sentry
      },
    });
  } catch (err) {
    // Log initialization errors
    // eslint-disable-next-line no-console
    console.error('Sentry.init failed:', err);
  }
};
