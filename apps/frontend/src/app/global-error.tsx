'use client';
import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // This component replaces the root layout, so the variables context is not
    // mounted here and its DSN was always '' — every React render crash in
    // production went unreported (upstream c0bd447d). Ask the SDK instead:
    // no client means Sentry is off.
    if (!Sentry.getClient()) {
      return;
    }
    const eventId = Sentry.captureException(error);
    Sentry.showReportDialog({
      eventId,
      title: 'Something broke!',
      subtitle: 'Please help us fix the issue by providing some details.',
      labelComments: 'What happened?',
      labelName: 'Your name',
      labelEmail: 'Your email',
      labelSubmit: 'Send Report',
      lang: 'en',
    });

  }, [error]);
  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
