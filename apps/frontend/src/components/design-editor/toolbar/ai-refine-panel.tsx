'use client';

import {
  FC,
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../editor.store';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { isFetchHandledError } from '@gitroom/helpers/utils/fetch.errors';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useAiError } from '@gitroom/frontend/components/ai/use-ai-error';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/frontend/components/ui/button';
import {
  applyPatchToCanvas,
  screenshotForVision,
  specFromCanvas,
} from '../utils/spec-canvas-bridge';
import {
  StudioPatch,
  StudioSpec,
} from '@gitroom/nestjs-libraries/studio/studio-spec';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';

interface Props {
  canvas: MutableRefObject<fabric.Canvas | null>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const QUICK_INSTRUCTIONS = [
  { key: 'refine_quick_shorter', fallback: 'Shorter headline' },
  { key: 'refine_quick_warmer', fallback: 'Warmer colours' },
  { key: 'refine_quick_bolder', fallback: 'Stronger CTA' },
  { key: 'refine_quick_minimal', fallback: 'More minimal' },
];

export const AiRefinePanel: FC<Props> = ({ canvas }) => {
  const { platform, pushHistory } = useEditorStore();
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const showAiError = useAiError();
  const user = useUser();
  const allowed = !!user?.tier?.image_generator;
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (text: string) => {
      if (!canvas.current || busy) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const c = canvas.current;
      if (!c.getObjects().length) {
        toaster.show(
          t(
            'refine_empty_canvas',
            'Add something to the canvas first — a template or AI Generate.'
          ),
          'warning'
        );
        return;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      setHistory((prev) => [...prev, { role: 'user', text: trimmed }]);
      setInstruction('');

      try {
        const spec: StudioSpec = specFromCanvas(c, platform);
        const screenshot = screenshotForVision(c);

        const res = await fetch('/media/refine-design', {
          method: 'POST',
          body: JSON.stringify({ spec, instruction: trimmed, screenshot }),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          await showAiError(
            res,
            t(
              'refine_failed',
              'AI could not refine the design — try a different instruction.'
            )
          );
          return;
        }

        const data = (await res.json()) as {
          patch: StudioPatch;
          explanation: string;
        };

        await applyPatchToCanvas(c, spec, data.patch);
        pushHistory(JSON.stringify(c.toJSON()));
        setHistory((prev) => [
          ...prev,
          { role: 'assistant', text: data.explanation },
        ]);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        // Handled globally (5xx/429/401) — its own message is already up, and
        // "try a different instruction" would blame the wrong thing.
        if (isFetchHandledError(err)) return;
        toaster.show(
          t(
            'refine_failed',
            'AI could not refine the design — try a different instruction.'
          ),
          'warning'
        );
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(false);
      }
    },
    [canvas, busy, platform, fetch, t, toaster, pushHistory]
  );

  if (!allowed) {
    return (
      <div className="text-[11px] text-textColor/60 leading-relaxed">
        {t(
          'ai_tier_required',
          'AI design is available on the Starter plan and above.'
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-textColor/60 mb-1">
          {t('refine_title', 'AI Refine')}
        </div>
        <p className="text-[11px] text-textColor/60 leading-snug">
          {t(
            'refine_intro',
            'Describe what to change in the current design. AI will edit the relevant elements instead of starting from scratch.'
          )}
        </p>
        <p className="text-[11px] text-textColor/65 leading-snug mt-1">
          {t(
            'refine_scope_hint',
            'It edits the design — text, colours, layout. It does not retouch photos (e.g. it can’t add a person to an image).'
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {QUICK_INSTRUCTIONS.map((q) => (
          <button
            key={q.key}
            disabled={busy}
            onClick={() => run(t(q.key, q.fallback))}
            className="text-[11px] px-2 py-1 rounded bg-newColColor hover:bg-white/[0.08] text-textColor/80 transition-colors disabled:opacity-40"
          >
            {t(q.key, q.fallback)}
          </button>
        ))}
      </div>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={t(
          'refine_placeholder',
          'e.g. "shorten the headline", "change the accent to warm orange", "move the logo to the bottom-right corner"'
        )}
        rows={3}
        disabled={busy}
        className="text-xs p-2 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/60 resize-none focus:outline-none focus:border-forth disabled:opacity-50"
      />

      <Button
        loading={busy}
        onClick={() => run(instruction)}
        className="!h-[32px] !text-xs"
      >
        {busy
          ? t('refine_running', 'Refining…')
          : t('refine_apply', 'Refine design')}
      </Button>

      {history.length > 0 && (
        <div className="flex flex-col gap-1 mt-1 max-h-40 overflow-y-auto pr-1">
          {history.slice(-6).map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'text-[11px] px-2 py-1 rounded bg-forth/15 border border-forth/30 text-textColor/90'
                  : 'text-[11px] px-2 py-1 rounded bg-newColColor/60 text-textColor/70'
              }
            >
              <span className="opacity-60 mr-1">
                {m.role === 'user' ? (
                  '›'
                ) : (
                  <StudioIcon name="aiGenerate" size={13} />
                )}
              </span>
              {m.text}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-textColor/65 leading-snug">
        {t(
          'refine_undo_hint',
          'Each iteration is saved in history — undo with Ctrl+Z.'
        )}
      </p>
    </div>
  );
};
