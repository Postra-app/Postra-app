'use client';

import { FC, useEffect, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';
import { DraftSaveResult } from './utils/draft-autosave';

export interface SaveState {
  result: DraftSaveResult;
  at: number;
}

/** "just now" up to a minute, then whole minutes. Exported for the spec: the
 *  wording is the whole point of the indicator. */
export const describeAge = (
  ageMs: number,
  t: (key: string, fallback: string) => string
): string => {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) return t('studio_saved_just_now', 'Saved just now');
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return t('studio_saved_a_minute', 'Saved a minute ago');
  return `${t('studio_saved_prefix', 'Saved')} ${minutes} ${t(
    'studio_saved_minutes_suffix',
    'minutes ago'
  )}`;
};

/**
 * Studio autosaves to the browser every 30 seconds, and up to now said nothing
 * about it — including when it gave up, which is exactly the case where the
 * user needs to know: a design with a cut-out background is too big for
 * localStorage, so a refresh would take it.
 */
export const SaveIndicator: FC<{ state: SaveState | null }> = ({ state }) => {
  const t = useT();
  const [, setTick] = useState(0);

  // The label ages while nothing else on the page changes.
  useEffect(() => {
    if (!state || state.result !== 'saved') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [state]);

  if (!state) return null;

  if (state.result !== 'saved') {
    return (
      <span
        className="flex items-center gap-1 text-[12px] text-yellow-400/90"
        title={t(
          'studio_autosave_off_hint',
          'This design is too large to keep in the browser. Save it to your library so a refresh cannot lose it.'
        )}
      >
        <StudioIcon name="warning" size={14} />
        {t('studio_autosave_off', 'Not autosaved')}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-[12px] text-textColor/55">
      <StudioIcon name="done" size={14} />
      {describeAge(Date.now() - state.at, t)}
    </span>
  );
};
