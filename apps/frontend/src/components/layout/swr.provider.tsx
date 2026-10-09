'use client';

import { ReactNode, useCallback, useRef } from 'react';
import { SWRConfig } from 'swr';
import {
  isFetchHandledError,
  isNetworkError,
} from '@gitroom/helpers/utils/fetch.errors';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/**
 * Global SWR error handler. Without this a failed `/user/self` or
 * `/integrations/list` silently renders an empty screen ("No channels yet")
 * and nothing is logged. We always emit a `[Postra:swr]` diagnostic and — at
 * most once every 5s so parallel failures don't spam — surface a toast.
 *
 * Note: 401/402/406/429 and any 5xx are intercepted globally (layout.context),
 * which makes customFetch reject with a `FetchHandledError` marker — the trial
 * / payment dialog or the global toast already owns those cases, so we ignore
 * them here rather than stacking a generic "something went wrong" on top. Only
 * real transport/parse failures reach the toast.
 */
export const SwrProvider = ({ children }: { children: ReactNode }) => {
  const toaster = useToaster();
  const t = useT();
  const lastToast = useRef(0);

  const onError = useCallback(
    (error: unknown, key: string) => {
      // Already surfaced globally (dialog or toast) — not a load failure.
      if (isFetchHandledError(error)) {
        return;
      }

      // The ConnectionStatus banner already says "you're offline" and stays up
      // until the connection returns; a toast repeating it is noise. Log at
      // info, not error: consoleLoggingIntegration ships warn/error to Sentry,
      // and one lift ride with a dozen mounted hooks would flood it.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.info('[Postra:swr] offline, skipped', key);
        return;
      }

      console.error('[Postra:swr]', key, error);
      if (Date.now() - lastToast.current > 5000) {
        lastToast.current = Date.now();
        toaster.show(
          // The browser thinks it is online but the request never landed
          // (captive portal, dead uplink, ALB down). "Refresh the page" would
          // be the wrong instruction, so say what actually failed.
          isNetworkError(error)
            ? t(
                'connection_error',
                "Can't reach the server - check your connection and try again."
              )
            : t(
                'data_load_error',
                'Something went wrong loading data - please refresh the page.'
              ),
          'warning'
        );
      }
    },
    [toaster, t]
  );

  return (
    <SWRConfig
      value={{
        onError,
        // During a backend incident the default is unbounded exponential
        // retries from every mounted hook in every tab — cap it.
        errorRetryCount: 3,
        focusThrottleInterval: 30_000,
        dedupingInterval: 5_000,
      }}
    >
      {children}
    </SWRConfig>
  );
};
