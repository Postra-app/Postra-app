'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  RegisterCancel,
  RenderJobRunner,
} from '@gitroom/frontend/components/video-studio/render-job';

export interface RenderJob {
  busy: boolean;
  /** 0..100, for the progress bar. */
  progress: number;
  setProgress: (value: number) => void;
  /** The user pressed Cancel and we are waiting for the pipeline to stop. */
  cancelling: boolean;
  run: <T>(
    fn: (signal: AbortSignal, register: RegisterCancel) => Promise<T>
  ) => Promise<T | null>;
  cancel: () => void;
}

/** React wrapper around {@link RenderJobRunner} — state for the buttons. */
export function useRenderJob(): RenderJob {
  const runner = useMemo(() => new RenderJobRunner(), []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  const run = useCallback(
    async <T,>(
      fn: (signal: AbortSignal, register: RegisterCancel) => Promise<T>
    ): Promise<T | null> => {
      setBusy(true);
      setCancelling(false);
      setProgress(0);
      try {
        return await runner.run(fn);
      } finally {
        setBusy(false);
        setCancelling(false);
      }
    },
    [runner]
  );

  const cancel = useCallback(() => {
    if (!runner.busy) return;
    setCancelling(true);
    runner.cancel();
  }, [runner]);

  return { busy, progress, setProgress, cancelling, run, cancel };
}
