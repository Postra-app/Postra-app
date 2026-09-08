'use client';

import { FC, useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useAiError } from '@gitroom/frontend/components/ai/use-ai-error';

interface Props {
  content: string;
}

interface VoiceResult {
  score: number;
  feedback: string;
  tags: string[];
}

const MIN_CONTENT_LEN = 20;

const scoreTone = (score: number): 'good' | 'warn' | 'bad' => {
  if (score >= 75) return 'good';
  if (score >= 45) return 'warn';
  return 'bad';
};

const TONE_CLASSES: Record<'good' | 'warn' | 'bad', string> = {
  good: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  warn: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  bad: 'bg-rose-500/15 border-rose-500/40 text-rose-200',
};

export const BrandVoiceRibbon: FC<Props> = ({ content }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const showAiError = useAiError();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const plainText = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ready = plainText.length >= MIN_CONTENT_LEN;

  const check = useCallback(async () => {
    if (!ready || busy) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);

    try {
      const res = await fetch('/media/brand-voice-check', {
        method: 'POST',
        body: JSON.stringify({ caption: plainText }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        await showAiError(
          res,
          t('voice_failed', 'Could not check the tone — try again later.')
        );
        return;
      }

      const data = (await res.json()) as VoiceResult;
      setResult(data);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        toaster.show(
          t('voice_failed', 'Could not check the tone — try again later.'),
          'warning'
        );
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
    }
  }, [ready, busy, plainText, fetch, t, toaster]);

  if (!ready) return null;

  const tone = result ? scoreTone(result.score) : null;

  return (
    <div className="flex flex-col gap-1 mt-1.5">
      {!result && (
        <button
          onClick={check}
          disabled={busy}
          className="self-start text-[10px] px-2 py-1 rounded bg-newColColor hover:bg-forth hover:text-white text-textColor/80 transition-colors disabled:opacity-50"
        >
          {busy
            ? t('voice_running', 'Checking tone…')
            : t('voice_check', '🎯 Check tone')}
        </button>
      )}

      {result && tone && (
        <div
          className={clsx(
            'rounded border px-2.5 py-1.5 text-[11px] leading-snug',
            TONE_CLASSES[tone]
          )}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-semibold">
              {t('voice_score', 'Brand voice')}: {result.score}/100
            </span>
            <button
              onClick={() => {
                setResult(null);
                check();
              }}
              className="text-[10px] opacity-70 hover:opacity-100 underline"
            >
              {t('voice_recheck', 'check again')}
            </button>
          </div>
          <p className="opacity-90">{result.feedback}</p>
          {(result.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {(result.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 uppercase tracking-wide"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
