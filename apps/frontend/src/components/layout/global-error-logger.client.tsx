'use client';

import { useEffect } from 'react';
import {
  isFetchHandledError,
  isNetworkError,
} from '@gitroom/helpers/utils/fetch.errors';

// Mounted once, app-wide. Captures the RAW error the instant it is thrown —
// before React's error boundary swallows it and before the stack frames are
// lost. This is what lets us diagnose render crashes (e.g. the recurring
// "Cannot read properties of undefined (reading 'map')" on paste) from a
// user's console: with production source maps linked, the logged stack points
// straight at the offending file:line. Everything is namespaced [Postra:*]
// so it is trivial to grep in a screenshot or copied console dump.
export const GlobalErrorLogger = (): null => {
  useEffect(() => {
    /* eslint-disable no-console */
    const onError = (event: ErrorEvent): void => {
      // The browser's own notice that a ResizeObserver callback changed layout
      // again in the same frame. Harmless and frequent (removing a channel
      // from a customer reflows the sidebar: ~10 at once), and as a
      // console.error it reached Sentry as a burst of errors.
      if (/^ResizeObserver loop/.test(event.message || '')) {
        return;
      }
      console.error('[Postra:window-error]', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        col: event.colno,
        url: window.location.href,
        time: new Date().toISOString(),
      });
      // Logged separately so devtools renders the clickable, source-mapped
      // stack rather than collapsing it into the object above.
      if (event.error?.stack) {
        console.error('[Postra:window-error] stack:', event.error.stack);
      }
    };

    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason: any = event.reason;
      // 401/402/406/429/5xx are handled globally (trial/payment dialog or a
      // toast); customFetch rejects with this marker so callers can unwind. It
      // is not a crash — swallow it instead of reporting a scary unhandled
      // rejection.
      if (isFetchHandledError(reason)) {
        event.preventDefault();
        return;
      }
      // A request that never reached the server is the connection failing, not
      // the app crashing — ConnectionStatus tells the user, and Sentry drops
      // these by message anyway. Keep the devtools breadcrumb, but at info so
      // it is not shipped as a console log too.
      if (isNetworkError(reason)) {
        console.info(
          '[Postra:network]',
          reason?.message ?? String(reason),
          window.location.href
        );
        event.preventDefault();
        return;
      }
      console.error('[Postra:unhandled-rejection]', {
        message: reason?.message ?? String(reason),
        url: window.location.href,
        time: new Date().toISOString(),
      });
      if (reason?.stack) {
        console.error('[Postra:unhandled-rejection] stack:', reason.stack);
      }
    };
    /* eslint-enable no-console */

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
};
