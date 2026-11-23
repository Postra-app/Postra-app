'use client';

import { FC, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  waitingPercent,
  waitingStep,
} from '@gitroom/frontend/components/ui/waiting-status.helpers';

// Mounted only while the wait lasts, so the count starts at zero each time.
const useElapsedSeconds = () => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed((Date.now() - started) / 1000),
      500
    );
    return () => clearInterval(timer);
  }, []);
  return elapsed;
};

/** A status line that changes while the user waits, with an optional bar. */
export const WaitingStatus: FC<{
  active: boolean;
  messages: string[];
  expectedSeconds: number;
  bar?: boolean;
  className?: string;
}> = ({ active, ...rest }) =>
  active && rest.messages.length > 0 ? <WaitingLine {...rest} /> : null;

const WaitingLine: FC<{
  messages: string[];
  expectedSeconds: number;
  bar?: boolean;
  className?: string;
}> = ({ messages, expectedSeconds, bar, className }) => {
  const elapsed = useElapsedSeconds();
  const message = messages[waitingStep(elapsed, messages.length, expectedSeconds)];
  const percent = waitingPercent(elapsed, expectedSeconds);
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx('flex flex-col gap-[6px]', className)}
    >
      {bar && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-[4px] w-full overflow-hidden rounded-full bg-textColor/10"
        >
          <div
            className="h-full rounded-full bg-newAccent transition-[width] duration-500 ease-linear"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <div className="flex items-center gap-[8px] text-[12px] text-textColor/70">
        <span className="inline-block h-[6px] w-[6px] shrink-0 animate-pulse rounded-full bg-newAccent" />
        <span>{message}</span>
      </div>
    </div>
  );
};
