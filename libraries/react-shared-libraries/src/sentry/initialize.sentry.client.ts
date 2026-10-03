import * as Sentry from '@sentry/nextjs';
import { initializeSentryBasic } from '@gitroom/react/sentry/initialize.sentry.next.basic';
import { screenshotDataUrl } from '@gitroom/react/sentry/screenshot.data.url';

export interface ProblemReport {
  name?: string;
  email?: string;
  message: string;
  // The screenshot the widget attached, as a data URL.
  screenshot?: string;
}

export const initializeSentryClient = (
  environment: string,
  dsn: string,
  // Called once a "Report a problem" is filed in Sentry, so the app can also
  // email it to the team (Sentry sends no mail for it on our plan).
  onProblemReport?: (report: ProblemReport, eventId: string) => void
) =>
  initializeSentryBasic(environment, dsn, {
    integrations: [
      // Add default integrations back
      Sentry.browserTracingIntegration(),
      Sentry.browserProfilingIntegration(),
      Sentry.replayIntegration({
        // GDPR: replays capture whatever the user sees (post drafts, emails),
        // so mask everything and record only when an error actually happens.
        maskAllText: true,
        maskAllInputs: true,
      }),
      Sentry.feedbackIntegration({
        // Disable the injection of the default widget — the topbar chat icon
        // (AttachToFeedbackIcon) opens it instead.
        autoInject: false,
        showBranding: false,
        // The app is dark regardless of OS preference — 'system' rendered a
        // white Sentry-purple dialog inside the dark UI.
        colorScheme: 'dark',
        themeDark: {
          background: '#0a0e1a',
          foreground: '#e6e8ee',
          accentBackground: '#38bdf8',
          accentForeground: '#0a0e1a',
          successColor: '#10b981',
          errorColor: '#ef4444',
          outline: '1px auto #38bdf8',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55)',
        },
        formTitle: 'Report a problem',
        submitButtonLabel: 'Send report',
        messagePlaceholder:
          "What went wrong? What did you expect to happen?",
        successMessageText: 'Thank you — we read every report.',
        onSubmitSuccess: (data: any, eventId: string) =>
          onProblemReport?.(
            {
              name: data.name,
              email: data.email,
              message: data.message,
              screenshot: screenshotDataUrl(data.attachments?.[0]),
            },
            eventId
          ),
      }),
      Sentry.replayCanvasIntegration(),
    ],
    // Error-only replays: the free tier includes ~50 replays/month, so recording
    // every session would exhaust the quota within a day.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,

    profilesSampleRate: environment === 'development' ? 1.0 : 0.1,
  });
