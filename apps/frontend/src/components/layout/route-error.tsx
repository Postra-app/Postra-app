'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Shared render-crash boundary UI for the route-group `error.tsx` files.
 * Without a boundary at each root segment, a single unguarded `.map` over
 * undefined API data white-screens the whole surface with Next.js's generic
 * "Application error". This contains the failure and offers recovery, while
 * logging in a greppable `[Postra:error-boundary]` shape and forwarding to
 * Sentry (a no-op when no DSN is configured).
 */
export function RouteError({
  error,
  reset,
  segment,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  segment: string;
}) {
  useEffect(() => {
    /* eslint-disable no-console */
    console.error(`[Postra:error-boundary] render crash (${segment}):`, {
      name: error?.name,
      message: error?.message,
      digest: error?.digest,
      url: typeof window !== 'undefined' ? window.location.href : '(ssr)',
      time: new Date().toISOString(),
    });
    console.error('[Postra:error-boundary] stack:', error?.stack || error);
    /* eslint-enable no-console */
    Sentry.captureException(error);
  }, [error, segment]);

  return (
    <div className="min-h-[60vh] w-full flex items-center justify-center p-[24px]">
      <div className="max-w-[440px] w-full rounded-[16px] border border-white/10 bg-[rgba(15,23,42,0.72)] backdrop-blur-xl p-[28px] text-center flex flex-col gap-[14px]">
        <div className="text-[40px]">⚠️</div>
        <div className="text-white text-[18px] font-[600]">
          Something went wrong
        </div>
        <div className="text-white/60 text-[14px]">
          An unexpected error occurred on this screen. The rest of the app keeps
          working - please try again.
        </div>
        <div className="flex gap-[10px] justify-center mt-[6px]">
          <button
            onClick={() => reset()}
            className="h-[40px] px-[18px] rounded-[8px] bg-[#38bdf8] text-[#0a0e1a] font-[600] text-[14px] cursor-pointer"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="h-[40px] px-[18px] rounded-[8px] bg-white/[0.06] border border-white/10 text-white text-[14px] cursor-pointer"
          >
            Refresh the page
          </button>
        </div>
      </div>
    </div>
  );
}
