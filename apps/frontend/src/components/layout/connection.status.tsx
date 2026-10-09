'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/**
 * Connection indicator, mounted once app-wide.
 *
 * Without it a dropped connection reads as "Postra is broken": every SWR hook
 * on the page fails at the same moment and the only feedback was a generic
 * "something went wrong loading data — please refresh the page", which blames
 * the app for the user's wifi and suggests the one action that cannot work.
 *
 * We only ever trust the offline edge: `navigator.onLine === false` is reliable
 * in every engine, while `true` merely means "an interface is up" (a captive
 * portal or a dead uplink still reports online). Anything the browser thinks is
 * online but still fails stays with SwrProvider's toast.
 *
 * Sits bottom-centre so it never covers the header nav or the toaster
 * (top-[32px], z-900), and so a state that can last minutes does not push the
 * page around.
 */
export const ConnectionStatus = () => {
  const t = useT();
  const [offline, setOffline] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const goOffline = () => {
      wasOffline.current = true;
      setReconnected(false);
      setOffline(true);
    };

    const goOnline = () => {
      setOffline(false);
      // Never announce a recovery we did not report breaking — a tab woken from
      // sleep can fire `online` without ever having fired `offline`.
      if (!wasOffline.current) {
        return;
      }
      wasOffline.current = false;
      // Confirm the recovery rather than silently vanishing: SWR revalidates on
      // reconnect, so the screen is about to refill on its own.
      setReconnected(true);
      timeout = setTimeout(() => setReconnected(false), 3000);
    };

    // Read after mount, not during render: the server has no `navigator`, and
    // deriving the first paint from it would flash the banner on hydration.
    if (!navigator.onLine) {
      goOffline();
    }

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, []);

  if (!offline && !reconnected) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'animate-fadeIn fixed bottom-[24px] start-[50%] -translate-x-[50%] z-[901]',
        'flex items-center gap-[10px] rounded-[8px] bg-customColor8 px-[16px] py-[10px]',
        'text-[14px] text-textColor',
        offline ? 'shadow-yellowToast' : 'shadow-greenToast'
      )}
    >
      <span
        className={clsx(
          'w-[8px] h-[8px] rounded-full shrink-0',
          offline ? 'bg-[#FEC84B]' : 'bg-[#6CE9A6]'
        )}
      />
      {offline
        ? t(
            'connection_offline',
            "You're offline - we'll reconnect automatically."
          )
        : t('connection_restored', 'Back online.')}
    </div>
  );
};
