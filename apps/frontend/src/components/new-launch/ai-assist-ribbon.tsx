'use client';

import { FC, useCallback, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useAiError } from '@gitroom/frontend/components/ai/use-ai-error';
import {
  AI_MIN_CONTENT_LEN,
  aiPlainText,
  aiTextToHtml,
} from '@gitroom/frontend/components/new-launch/ai-text.utils';

interface Props {
  content: string;
  platform?: string;
  onReplace: (html: string) => void;
}

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

/**
 * The two the product ships in. The backend validates against the same pair,
 * so a caller cannot ask for a language by typing one into the request.
 */
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' },
];

export const AiAssistRibbon: FC<Props> = ({ content, platform, onReplace }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const showAiError = useAiError();
  const [busy, setBusy] = useState<string | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [languages, setLanguages] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const plainText = aiPlainText(content);
  const ready = plainText.length >= AI_MIN_CONTENT_LEN;

  const run = useCallback(
    async (action: string, language?: string) => {
      if (!ready || busy) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(action);
      setLanguages(false);

      try {
        const res = await fetch('/media/ai-edit', {
          method: 'POST',
          body: JSON.stringify({ text: plainText, action, platform, language }),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          await showAiError(
            res,
            t('ai_edit_failed', 'Could not rewrite the text — try again later.')
          );
          return;
        }

        const data = (await res.json()) as { text: string };
        if (data?.text) onReplace(aiTextToHtml(data.text));
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          toaster.show(
            t(
              'ai_edit_failed',
              'Could not rewrite the text — try again later.'
            ),
            'warning'
          );
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(null);
      }
    },
    [
      ready,
      busy,
      plainText,
      platform,
      fetch,
      t,
      toaster,
      showAiError,
      onReplace,
    ]
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
        await showAiError(
          res,
          t(
            'ai_hashtags_failed',
            'Could not suggest hashtags — try again later.'
          )
        );
        return;
      }
      const data = (await res.json()) as { hashtags: string[] };
      const list = data?.hashtags ?? [];
      setTags(list);
      setPicked(new Set(list));
    } catch {
      toaster.show(
        t(
          'ai_hashtags_failed',
          'Could not suggest hashtags — try again later.'
        ),
        'warning'
      );
    } finally {
      setBusy(null);
    }
  }, [ready, busy, plainText, platform, fetch, t, toaster, showAiError]);

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

      {/* Translate asks which language rather than guessing: a UK-first
          product with Polish users has no safe default here. */}
      <button
        onClick={() => setLanguages((open) => !open)}
        disabled={!!busy}
        className="text-[11px] px-2 py-1 rounded bg-newColColor hover:bg-white/[0.08] text-newTextColor/80 transition-colors disabled:opacity-50"
      >
        {busy === 'translate'
          ? t('ai_translate_running', 'Translating…')
          : t('ai_edit_translate', 'Translate')}
      </button>

      {languages && !busy && (
        <>
          {LANGUAGES.map((language) => (
            <button
              key={language.code}
              onClick={() => run('translate', language.code)}
              className="text-[11px] px-2 py-1 rounded bg-newAccent text-[#06222e] font-[600] hover:bg-forth transition-colors"
            >
              {language.label}
            </button>
          ))}
          <button
            onClick={() => setLanguages(false)}
            className="text-[11px] px-2 py-1 rounded text-newTextColor/60 hover:text-newTextColor transition-colors"
          >
            {t('dismiss', 'Dismiss')}
          </button>
        </>
      )}

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
