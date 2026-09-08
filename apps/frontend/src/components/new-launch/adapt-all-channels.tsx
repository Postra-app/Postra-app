'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import {
  AI_MIN_CONTENT_LEN,
  aiPlainText,
  aiTextToHtml,
  selectAdaptTargets,
} from '@gitroom/frontend/components/new-launch/ai-text.utils';

// One rewrite per post per channel. Beyond this the throttle on /media/ai-edit
// (30 calls / 5 min) would cut the run off half-way and leave some channels
// adapted and others not, which is worse than not starting.
const MAX_CALLS = 24;

export const AdaptAllChannels: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [busy, setBusy] = useState(false);

  const {
    current,
    global,
    selectedIntegrations,
    internal,
    addRemoveInternal,
    setInternalValueText,
  } = useLaunchStore(
    useShallow((state) => ({
      current: state.current,
      global: state.global,
      selectedIntegrations: state.selectedIntegrations,
      internal: state.internal,
      addRemoveInternal: state.addRemoveInternal,
      setInternalValueText: state.setInternalValueText,
    }))
  );

  // Channels that already carry their own version keep it: adapting them would
  // throw away text the user wrote by hand.
  const targets = useMemo(
    () => selectAdaptTargets(selectedIntegrations, internal),
    [selectedIntegrations, internal]
  );

  const posts = useMemo(
    () => (global ?? []).map((post) => aiPlainText(post?.content ?? '')),
    [global]
  );

  const hasText = posts.some((p) => p.length >= AI_MIN_CONTENT_LEN);

  const run = useCallback(async () => {
    if (busy || !targets.length || !hasText) return;

    const writable = posts.filter((p) => p.length >= AI_MIN_CONTENT_LEN).length;
    if (targets.length * writable > MAX_CALLS) {
      toaster.show(
        t(
          'ai_adapt_all_too_big',
          'Too many channels and posts to adapt in one go. Adapt them from each channel tab instead.'
        ),
        'warning'
      );
      return;
    }

    setBusy(true);
    let adapted = 0;
    let failed = 0;
    let stopped: 'credits' | 'rate' | null = null;

    try {
      for (const target of targets) {
        if (stopped) break;

        const rewritten: (string | null)[] = [];
        for (const text of posts) {
          if (text.length < AI_MIN_CONTENT_LEN) {
            rewritten.push(null);
            continue;
          }

          const res = await fetch('/media/ai-edit', {
            method: 'POST',
            body: JSON.stringify({
              text,
              action: 'adapt',
              platform: target.integration.identifier,
            }),
          });

          if (res.status === 402 || res.status === 429) {
            stopped = res.status === 402 ? 'credits' : 'rate';
            break;
          }
          if (!res.ok) {
            rewritten.push(null);
            continue;
          }

          const data = (await res.json()) as { text?: string };
          rewritten.push(data?.text ? aiTextToHtml(data.text) : null);
        }

        if (stopped) break;

        // Only create the per-channel version once there is something to put
        // in it — an empty override would silently change what gets published.
        if (!rewritten.some((html) => html)) {
          failed++;
          continue;
        }

        addRemoveInternal(target.integration.id);
        rewritten.forEach((html, index) => {
          if (html) setInternalValueText(target.integration.id, index, html);
        });
        adapted++;
      }
    } finally {
      setBusy(false);
    }

    if (stopped === 'credits') {
      toaster.show(
        t(
          'ai_no_credits',
          'You are out of AI credits for this billing cycle. Upgrade your plan or wait for the next one.'
        ),
        'warning'
      );
      return;
    }
    if (stopped === 'rate') {
      toaster.show(
        t(
          'ai_adapt_all_rate_limited',
          'Too many AI requests for now. Wait a few minutes and run it again.'
        ),
        'warning'
      );
      return;
    }
    if (!adapted) {
      toaster.show(
        t('ai_adapt_all_failed', 'Could not adapt the post — try again later.'),
        'warning'
      );
      return;
    }

    toaster.show(
      t(
        'ai_adapt_all_done',
        'Adapted {{adapted}} channel(s). Kept {{kept}} as they were.',
        { adapted, kept: internal.length + failed }
      ),
      'success'
    );
  }, [
    busy,
    targets,
    hasText,
    posts,
    fetch,
    addRemoveInternal,
    setInternalValueText,
    internal.length,
    toaster,
    t,
  ]);

  // Only meaningful on the shared text, and only when there is more than one
  // channel to tell apart.
  if (current !== 'global' || selectedIntegrations.length < 2 || !hasText) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-1.5">
      <button
        onClick={run}
        disabled={busy || !targets.length}
        className="text-[11px] px-2 py-1 rounded bg-newColColor hover:bg-white/[0.08] text-newTextColor/80 transition-colors disabled:opacity-50"
      >
        {busy
          ? t('ai_adapt_all_running', 'Adapting each channel…')
          : t('ai_adapt_all', 'Adapt to each channel')}
      </button>
      <span className="text-[11px] text-newTextColor/60">
        {targets.length
          ? t(
              'ai_adapt_all_hint',
              'Writes a separate version per channel. Channels you already edited stay untouched.'
            )
          : t(
              'ai_adapt_all_nothing',
              'Every channel already has its own version.'
            )}
      </span>
    </div>
  );
};
