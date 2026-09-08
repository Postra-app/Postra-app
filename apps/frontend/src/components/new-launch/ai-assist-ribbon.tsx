'use client';

import { FC, useCallback, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface Props {
  content: string;
  platform?: string;
  onReplace: (html: string) => void;
}

const MIN_CONTENT_LEN = 10;

const ACTIONS: {
  key: string;
  labelKey: string;
  fallback: string;
  needsPlatform?: boolean;
}[] = [
  { key: 'improve', labelKey: 'ai_edit_improve', fallback: '✨ Improve' },
  { key: 'shorten', labelKey: 'ai_edit_shorten', fallback: 'Shorten' },
  { key: 'expand', labelKey: 'ai_edit_expand', fallback: 'Expand' },
  {
    key: 'adapt',
    labelKey: 'ai_edit_adapt',
    fallback: 'Adapt to platform',
    needsPlatform: true,
  },
  { key: 'fix_tone', labelKey: 'ai_edit_fix_tone', fallback: 'Fix tone' },
];

// The AI returns plain text; the editor stores <p>-per-line HTML, so wrap it.
const toHtml = (text: string) =>
  text
    .split('\n')
    .map((line) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<p>${escaped || '<br>'}</p>`;
    })
    .join('');

export const AiAssistRibbon: FC<Props> = ({ content, platform, onReplace }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const plainText = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ready = plainText.length >= MIN_CONTENT_LEN;

  const run = useCallback(
    async (action: string) => {
      if (!ready || busy) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(action);

      try {
        const res = await fetch('/media/ai-edit', {
          method: 'POST',
          body: JSON.stringify({ text: plainText, action, platform }),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          toaster.show(
            res.status === 402
              ? t('ai_no_credits', 'You ran out of AI credits.')
              : t(
                  'ai_edit_failed',
                  'Could not rewrite the text — try again later.'
                ),
            'warning'
          );
          return;
        }

        const data = (await res.json()) as { text: string };
        if (data?.text) onReplace(toHtml(data.text));
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          toaster.show(
            t('ai_edit_failed', 'Could not rewrite the text — try again later.'),
            'warning'
          );
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(null);
      }
    },
    [ready, busy, plainText, platform, fetch, t, toaster, onReplace]
  );

  const suggest = useCallback(async () => {
    if (!ready || busy) return;
    setBusy('hashtags');
    try {
      const res = await fetch('/media/suggest-hashtags', {
        method: 'POST',
        body: JSON.stringify({ text: plainText, platform }),
      });
      if (!res.ok) {
        toaster.show(
          res.status === 402
            ? t('ai_no_credits', 'You ran out of AI credits.')
            : t('ai_hashtags_failed', 'Could not suggest hashtags — try again later.'),
          'warning'
        );
        return;
      }
      const data = (await res.json()) as { hashtags: string[] };
      const list = data?.hashtags ?? [];
      setTags(list);
      setPicked(new Set(list));
    } catch {
      toaster.show(
        t('ai_hashtags_failed', 'Could not suggest hashtags — try again later.'),
        'warning'
      );
    } finally {
      setBusy(null);
    }
  }, [ready, busy, plainText, platform, fetch, t, toaster]);

  // Append rather than replace: the caption the user wrote stays exactly as it
  // is, tags go on a line of their own at the end.
  const addPicked = useCallback(() => {
    const chosen = (tags ?? []).filter((tag) => picked.has(tag));
    if (!chosen.length) return;
    onReplace(`${content}<p>${chosen.join(' ')}</p>`);
    setTags(null);
    setPicked(new Set());
  }, [tags, picked, content, onReplace]);

  if (!ready) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {ACTIONS.filter((a) => !a.needsPlatform || platform).map((a) => (
        <button
          key={a.key}
          onClick={() => run(a.key)}
          disabled={!!busy}
          className="text-[11px] px-2 py-1 rounded bg-newColColor hover:bg-white/[0.08] text-newTextColor/80 transition-colors disabled:opacity-50"
        >
          {busy === a.key
            ? t('ai_edit_running', 'Rewriting…')
            : t(a.labelKey, a.fallback)}
        </button>
      ))}

      <button
        onClick={suggest}
        disabled={!!busy}
        className="text-[11px] px-2 py-1 rounded bg-newColColor hover:bg-white/[0.08] text-newTextColor/80 transition-colors disabled:opacity-50"
      >
        {busy === 'hashtags'
          ? t('ai_hashtags_running', 'Finding hashtags…')
          : t('ai_edit_hashtags', '# Hashtags')}
      </button>

      {tags !== null && (
        <div className="basis-full flex flex-wrap items-center gap-1 mt-1">
          {tags.length === 0 && (
            <span className="text-[11px] text-newTextColor/60">
              {t('ai_hashtags_none', 'No hashtags worth adding to this one.')}
            </span>
          )}
          {tags.map((tag) => {
            const on = picked.has(tag);
            return (
              <button
                key={tag}
                onClick={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(tag)) next.delete(tag);
                    else next.add(tag);
                    return next;
                  })
                }
                className={
                  'text-[11px] px-2 py-1 rounded transition-colors ' +
                  (on
                    ? 'bg-newAccent text-[#06222e] font-[600]'
                    : 'bg-newColColor text-newTextColor/70 hover:bg-white/[0.08]')
                }
              >
                {tag}
              </button>
            );
          })}
          {tags.length > 0 && (
            <button
              onClick={addPicked}
              disabled={!picked.size}
              className="text-[11px] px-2 py-1 rounded underline text-newTextColor/80 hover:text-newTextColor disabled:opacity-50"
            >
              {t('ai_hashtags_add', 'Add to post')}
            </button>
          )}
          <button
            onClick={() => setTags(null)}
            className="text-[11px] px-2 py-1 rounded text-newTextColor/60 hover:text-newTextColor transition-colors"
          >
            {t('dismiss', 'Dismiss')}
          </button>
        </div>
      )}
    </div>
  );
};
