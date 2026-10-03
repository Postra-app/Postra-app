'use client';

import { FC, ReactNode, useEffect } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { initializeSentryClient } from '@gitroom/react/sentry/initialize.sentry.client';
import { customFetch } from '@gitroom/helpers/utils/custom.fetch.func';

export const SentryComponent: FC<{ children: ReactNode }> = ({ children }) => {
  const { sentryDsn: dsn, environment, backendUrl, isSecured } = useVariables();

  useEffect(() => {
    if (!dsn) {
      return;
    }

    const fetch = customFetch({ baseUrl: backendUrl }, undefined, undefined, isSecured);
    initializeSentryClient(environment, dsn, (report, eventId) => {
      // Best effort: the report is already in Sentry if this fails.
      fetch('/user/problem-report', {
        method: 'POST',
        body: JSON.stringify({
          ...report,
          email: report.email || undefined,
          eventId,
          page: window.location.pathname,
        }),
      }).catch(() => undefined);
    });
  }, [dsn]);

  // Always render children - don't block the app
  return <>{children}</>;
};
