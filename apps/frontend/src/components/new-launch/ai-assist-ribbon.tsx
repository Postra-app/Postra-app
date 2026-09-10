'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useAiError } from '@gitroom/frontend/components/ai/use-ai-error';
import {
  AI_MIN_CONTENT_LEN,
  aiPlainText,
  aiTextToHtml,
} from '@gitroom/frontend/components/new-launch/ai-text.utils';
import {
  diffSimilarity,
  diffWords,
} from '@gitroom/frontend/components/new-launch/ai-word-diff';

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

interface Variant {
  action: string;
  language?: string;
  /** Plain text the model was given — Retry re-runs on this, not on a result. */
  from: string;
  text: string;
}

// Enough to compare "the shorter one" with "the one before it" without turning
// the ribbon into a history browser.
const MAX_VARIANTS = 3;

// Below this share of shared words an inline diff is noise rather than help —
// Translate replaces every word — so the preview opens on the new text.
const DIFF_USEFUL_ABOVE = 0.3;

// Only used to tell "the user typed something" from "we put this here". The
// editor may hand the same text back with different entities or a non-breaking
// space, and that must not count as an edit.
const normalize = (html: string) =>
  aiPlainText(html)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

  // A rewrite lands here first. Nothing reaches the post until Apply.
  const [variants, setVariants] = useState<Variant[]>([]);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<'diff' | 'new'>('diff');
  /** What the post said before the first Apply — where Restore goes back to. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [applied, setApplied] = useState<{
    html: string;
    variant: Variant;
  } | null>(null);

  const plainText = aiPlainText(content);
  const ready = plainText.length >= AI_MIN_CONTENT_LEN;
  const variant = variants[index] ?? null;

  const segments = useMemo(
    () => (variant ? diffWords(variant.from, variant.text) : []),
    [variant]
  );

  const close = useCallback(() => {
    setVariants([]);
    setIndex(0);
    setBaseline(null);
    setApplied(null);
  }, []);

  // A preview describes one exact pair of texts. Once the post says something
  // else — the user kept typing, or switched channel tab — it would be
  // describing a change that can no longer be applied honestly.
  useEffect(() => {
    if (!variant || busy) return;
    const expected = applied ? applied.html : variant.from;
    if (normalize(content) !== normalize(expected)) close();
  }, [content, variant, applied, busy, close]);

  const run = useCallback(
    async (action: string, language?: string, retryFrom?: string) => {
      if (busy) return;
      const source = retryFrom ?? plainText;
      if (source.length < AI_MIN_CONTENT_LEN) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(action);
      setLanguages(false);

      try {
        const res = await fetch('/media/ai-edit', {
          method: 'POST',
          body: JSON.stringify({ text: source, action, platform, language }),
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
        if (!data?.text) return;

        // Remember what the post said before AI touched it, so Restore has
        // somewhere to go even after Apply.
        setBaseline((prev) => (prev === null ? content : prev));
        setVariants((prev) => {
          const next = [
            ...prev,
            { action, language, from: source, text: data.text },
          ].slice(-MAX_VARIANTS);
          setIndex(next.length - 1);
          return next;
        });
        setView(
          diffSimilarity(diffWords(source, data.text)) >= DIFF_USEFUL_ABOVE
            ? 'diff'
            : 'new'
        );
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
    [busy, plainText, content, platform, fetch, t, toaster, showAiError]
  );

  const apply = useCallback(() => {
    if (!variant) return;
    const html = aiTextToHtml(variant.text);
    onReplace(html);
    setApplied({ html, variant });
  }, [variant, onReplace]);

  const restore = useCallback(() => {
    if (baseline === null) return;
    onReplace(baseline);
    close();
  }, [baseline, onReplace, close]);

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

  const definition = ACTIONS.find((a) => a.key === variant?.action);
  const actionLabel = definition
    ? t(definition.labelKey, definition.fallback)
    : t('ai_edit_translate', 'Translate');
  const isApplied = applied?.variant === variant;

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

      {/* The rewrite, before it touches the post: what changed, then Apply.
          Restore puts back the text that was written by hand. */}
      {variant && (
        <div className="basis-full mt-1 rounded border border-newBorder bg-newColColor/60 p-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="font-[600] text-newTextColor/90">
              {isApplied
                ? t('ai_preview_applied', 'Applied')
                : t('ai_preview_title', 'Preview')}
              {' · '}
              {actionLabel}
            </span>

            {variants.length > 1 && (
              <span className="flex items-center gap-1 text-newTextColor/60">
                <button
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                  className="px-1 hover:text-newTextColor disabled:opacity-40"
                  aria-label={t('ai_preview_prev', 'Previous version')}
                >
                  ‹
                </button>
                {t('ai_preview_counter', 'version {{n}} of {{total}}', {
                  n: index + 1,
                  total: variants.length,
                })}
                <button
                  onClick={() =>
                    setIndex((i) => Math.min(variants.length - 1, i + 1))
                  }
                  disabled={index === variants.length - 1}
                  className="px-1 hover:text-newTextColor disabled:opacity-40"
                  aria-label={t('ai_preview_next', 'Next version')}
                >
                  ›
                </button>
              </span>
            )}

            <span className="ms-auto flex items-center gap-1">
              {(['diff', 'new'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  className={clsx(
                    'px-1.5 py-0.5 rounded transition-colors',
                    view === mode
                      ? 'bg-newAccent text-[#06222e] font-[600]'
                      : 'text-newTextColor/60 hover:text-newTextColor'
                  )}
                >
                  {mode === 'diff'
                    ? t('ai_preview_changes', 'Changes')
                    : t('ai_preview_new', 'New text')}
                </button>
              ))}
            </span>
          </div>

          <div className="max-h-[180px] overflow-y-auto whitespace-pre-wrap leading-relaxed text-newTextColor/90">
            {view === 'new'
              ? variant.text
              : segments.map((segment, i) => (
                  <span
                    key={i}
                    className={clsx(
                      segment.kind === 'add' && 'bg-emerald-500/25 rounded-sm',
                      segment.kind === 'del' &&
                        'bg-rose-500/25 line-through rounded-sm text-newTextColor/60'
                    )}
                  >
                    {segment.text}
                  </span>
                ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {!isApplied && (
              <button
                onClick={apply}
                disabled={!!busy}
                className="px-2 py-1 rounded bg-newAccent text-[#06222e] font-[600] hover:bg-forth transition-colors disabled:opacity-50"
              >
                {t('ai_preview_apply', 'Apply')}
              </button>
            )}

            <button
              onClick={() =>
                run(variant.action, variant.language, variant.from)
              }
              disabled={!!busy}
              className="px-2 py-1 rounded bg-newColColor hover:bg-white/[0.08] text-newTextColor/80 transition-colors disabled:opacity-50"
            >
              {busy
                ? t('ai_edit_running', 'Rewriting…')
                : t('ai_preview_retry', 'Retry')}
            </button>

            {applied && (
              <button
                onClick={restore}
                disabled={!!busy}
                className="px-2 py-1 rounded bg-newColColor hover:bg-white/[0.08] text-newTextColor/80 transition-colors disabled:opacity-50"
              >
                {t('ai_preview_restore', 'Restore original')}
              </button>
            )}

            <button
              onClick={close}
              className="px-2 py-1 rounded text-newTextColor/60 hover:text-newTextColor transition-colors"
            >
              {t('dismiss', 'Dismiss')}
            </button>

            <span className="ms-auto text-newTextColor/50">
              {t('ai_preview_chars', '{{before}} → {{after}} characters', {
                before: variant.from.length,
                after: variant.text.length,
              })}
            </span>
          </div>
        </div>
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
