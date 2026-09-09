'use client';

import { FC, MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../editor.store';
import { useCarouselStore, CarouselSlide } from '../carousel.store';
import { renderDesignSpec, PostDesignSpec } from '../utils/canvas-renderer';
import { withHistoryPaused } from '../utils/canvas-history';
import { useHolidays, getUpcomingHolidays } from '../utils/holidays';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { isFetchHandledError } from '@gitroom/helpers/utils/fetch.errors';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useTranslation } from 'react-i18next';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useBrandKit } from '@gitroom/frontend/components/video-studio/use-brand-kit';

interface Props {
  canvas: MutableRefObject<fabric.Canvas | null>;
}

export const AiGeneratePanel: FC<Props> = ({ canvas }) => {
  const {
    aiPrompt,
    setAiPrompt,
    isGenerating,
    setGenerating,
    platform,
    setTool,
    setPendingTemplateQuery,
  } = useEditorStore();
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const { i18n } = useTranslation();
  const user = useUser();
  const allowed = !!user?.tier?.image_generator;
  const holidays = useHolidays();
  // Nearest 4 with no day cap — the UK calendar has a July→October desert
  // where a 90-day window left one lonely chip that never seemed to change.
  const upcoming = getUpcomingHolidays(holidays, 4, 365);
  const brandKit = useBrandKit();
  const abortRef = useRef<AbortController | null>(null);
  const [slidesCount, setSlidesCount] = useState(1);
  // Prompt parked while the user decides whether to replace a non-empty canvas.
  const [confirmPrompt, setConfirmPrompt] = useState<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // promptOverride lets the occasion chips generate in one click — the chip
  // passes its prompt directly because setAiPrompt hasn't re-rendered yet.
  const generate = useCallback(async (promptOverride?: string, skipConfirm = false) => {
    const prompt = (promptOverride ?? aiPrompt).trim();
    if (!canvas.current || isGenerating) return;
    if (!prompt) {
      toaster.show(t('ai_prompt_required', 'Describe what you want to generate'), 'warning');
      return;
    }

    // Generation replaces the whole canvas — if there's work on it, ask first.
    if (!skipConfirm && canvas.current.getObjects().length > 0) {
      setConfirmPrompt(prompt);
      return;
    }
    setConfirmPrompt(null);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGenerating(true);
    try {
      const isCarousel = slidesCount > 1;
      // On-image text follows the app language — without an explicit target a
      // Polish brand-kit tone can tip the model into Polish even for an
      // English prompt (see MediaService.createBrandedDraft).
      const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en')
        .toLowerCase()
        .startsWith('pl')
        ? 'Polish'
        : 'English';
      const res = isCarousel
        ? await fetch('/media/generate-carousel-design', {
            method: 'POST',
            body: JSON.stringify({
              prompt,
              platform: platform.key,
              slidesCount,
              language,
            }),
            signal: ctrl.signal,
          })
        : await fetch('/media/generate-post-design', {
            method: 'POST',
            body: JSON.stringify({ prompt, platform: platform.key, language }),
            signal: ctrl.signal,
          });

      if (!res.ok) {
        let serverMessage = '';
        try {
          const body = await res.json();
          serverMessage = typeof body?.message === 'string' ? body.message : '';
        } catch {
          // backend returned non-JSON — ignore, fall through to generic copy
        }

        if (res.status === 402) {
          toaster.show(
            t('ai_no_credits', 'You ran out of AI credits this month. Upgrade your plan or wait for the new cycle.'),
            'warning'
          );
        } else if (res.status === 401 || res.status === 403) {
          toaster.show(
            t('ai_forbidden', 'AI is not available on your plan. Check your subscription settings.'),
            'warning'
          );
        } else if (res.status === 429) {
          toaster.show(
            t('ai_rate_limited', 'Too many requests — wait a few seconds and try again.'),
            'warning'
          );
        } else {
          toaster.show(
            serverMessage ||
              t('ai_generate_failed', 'AI generation failed. Try a different prompt or check your connection.'),
            'warning'
          );
        }
        return;
      }

      const data = await res.json();
      if (ctrl.signal.aborted) return;

      if (isCarousel) {
        const slideSpecs = (data?.slides ?? []) as PostDesignSpec[];
        if (!slideSpecs.length) {
          toaster.show(
            t('ai_generate_failed', 'AI generation failed. Try a different prompt or check your connection.'),
            'warning'
          );
          return;
        }
        const slides: CarouselSlide[] = [];
        // Five slides, each a full canvas rebuild, pushed roughly forty history
        // entries — past the 30-entry cap, so the design the user had BEFORE
        // generating was evicted. The whole generation is one undo step now.
        await withHistoryPaused(canvas.current, async () => {
          for (let i = 0; i < slideSpecs.length; i += 1) {
            await renderDesignSpec(canvas.current!, slideSpecs[i], platform);
            slides.push({
              id: `slide-${Date.now().toString(36)}-${i}`,
              canvasJson: JSON.stringify(canvas.current!.toJSON()),
            });
          }
          useCarouselStore.getState().replaceAllSlides(slides);
          // The loop leaves the canvas on the LAST slide, but the strip activates
          // slide 1 — reload slide 1 so the canvas matches the highlighted thumbnail
          // (otherwise clicking thumbnail 1 is a no-op and the canvas looks stuck).
          await canvas.current!.loadFromJSON(slides[0].canvasJson!);
          canvas.current!.renderAll();
        });
      } else {
        const spec = data as PostDesignSpec;
        await withHistoryPaused(canvas.current, () =>
          renderDesignSpec(canvas.current!, spec, platform)
        );
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      // A globally-handled status (5xx/429/401) already showed its own message.
      // Telling the user to "try a different prompt" during a backend restart
      // sends them off rewriting perfectly good input.
      if (isFetchHandledError(err)) return;
      toaster.show(
        t('ai_generate_failed', 'AI generation failed. Try a different prompt or check your connection.'),
        'warning'
      );
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setGenerating(false);
    }
  }, [canvas, aiPrompt, platform, isGenerating, fetch, toaster, t, setGenerating, slidesCount, i18n]);

  if (!allowed) {
    return (
      <div className="flex flex-col gap-2 text-[11px] text-textColor/60 leading-relaxed">
        <span className="text-[11px] uppercase tracking-wide text-textColor/60">
          {t('ai_generate', 'AI Generate')}
        </span>
        <p>
          {t(
            'ai_tier_required',
            'AI design is available on the Starter plan and above.'
          )}
        </p>
        {/* The occasion calendar is free information that happened to live
            inside a paid panel, so the free plan saw none of it. The chips stay
            — they just open Templates on that occasion instead of generating,
            which is the thing this plan can actually do. */}
        {upcoming.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-[11px] uppercase tracking-wide text-textColor/65">
              {t('holiday_suggestions', 'Upcoming occasions')}
            </span>
            {upcoming.map((entry) => (
              <button
                key={entry.holiday.date}
                onClick={() => {
                  setPendingTemplateQuery(entry.holiday.localName);
                  setTool('templates');
                }}
                title={t(
                  'holiday_browse_templates',
                  'Find a template for this occasion'
                )}
                className="text-left text-[11px] px-2 py-1.5 rounded bg-newColColor/60 hover:bg-newColColor border border-newBorder/50 text-textColor/80 hover:text-textColor transition-colors"
              >
                {t('holiday_upcoming', 'In')} {entry.days}{' '}
                {entry.days === 1
                  ? t('holiday_day', 'day')
                  : t('holiday_days', 'days')}
                : <strong>{entry.holiday.localName}</strong>
              </button>
            ))}
            <p className="text-[11px] text-textColor/65 leading-snug">
              {t(
                'holiday_templates_hint',
                'Opens Templates filtered for the occasion — free on every plan.'
              )}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-wide text-textColor/60">
        {t('ai_generate', 'AI Generate')}
      </span>
      {!brandKit.loading && !brandKit.exists && (
        <div className="rounded-md bg-forth/10 border border-forth/30 px-2 py-1.5 flex flex-col gap-1.5">
          <p className="text-[11px] leading-snug text-textColor/80">
            {t(
              'brand_kit_nudge',
              'Set up your Brand Kit once — AI writes in your tone, designs come out in your colours and font, and your logo goes on every generated design.'
            )}
          </p>
          <button
            onClick={() => setTool('brand')}
            className="self-start text-[11px] px-2 py-1 rounded bg-forth/20 hover:bg-white/[0.08] text-textColor transition-colors"
          >
            {t('brand_kit_nudge_cta', 'Set up brand')}
          </button>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-textColor/65">
            {t('holiday_suggestions', 'Upcoming occasions')}
          </span>
          <div className="flex flex-col gap-1">
            {upcoming.map((entry) => {
              const occasionPrompt = `${t('holiday_post_prefix', 'Post for')} ${entry.holiday.localName}`;
              return (
                <div key={entry.holiday.date} className="flex gap-1">
                  <button
                    onClick={() => {
                      setAiPrompt(occasionPrompt);
                      generate(occasionPrompt);
                    }}
                    disabled={isGenerating}
                    title={t('holiday_generate_now', 'Generate a design for this occasion now')}
                    className="flex-1 text-left text-[11px] px-2 py-1.5 rounded bg-newColColor/60 hover:bg-newColColor border border-newBorder/50 text-textColor/80 hover:text-textColor transition-colors disabled:opacity-50"
                  >
                    {t('holiday_upcoming', 'In')} {entry.days}{' '}
                    {entry.days === 1
                      ? t('holiday_day', 'day')
                      : t('holiday_days', 'days')}
                    : <strong>{entry.holiday.localName}</strong>
                  </button>
                  <button
                    onClick={() => setAiPrompt(occasionPrompt)}
                    disabled={isGenerating}
                    title={t('holiday_fill_prompt', 'Fill the prompt so you can edit it before generating')}
                    className="px-2 rounded bg-newColColor/40 hover:bg-newColColor border border-newBorder/50 text-textColor/60 hover:text-textColor transition-colors disabled:opacity-50"
                  >
                    ✎
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-textColor/65 leading-snug">
            {t(
              'holiday_or_custom',
              'Click an occasion to generate instantly (✎ fills the prompt for editing) — or type your own idea below.'
            )}
          </p>
        </div>
      )}
      <textarea
        value={aiPrompt}
        onChange={(e) => setAiPrompt(e.target.value)}
        placeholder={t(
          'ai_prompt_placeholder',
          'e.g. Summer sale -50% at a clothing store'
        )}
        rows={4}
        disabled={isGenerating}
        className="text-xs p-2 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/40 resize-none focus:outline-none focus:border-forth disabled:opacity-50"
      />
      <div className="flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-wide text-textColor/60">
          {t('ai_slides_count', 'Slides')}
        </label>
        <select
          value={slidesCount}
          onChange={(e) => setSlidesCount(Number(e.target.value))}
          disabled={isGenerating}
          className="text-xs px-2 py-1 rounded bg-newColColor border border-newBorder text-textColor focus:outline-none focus:border-forth disabled:opacity-50"
          title={t('ai_slides_hint', 'Choose the number of slides for a carousel (1 = single post, 2-5 = carousel)')}
        >
          <option value={1}>1 ({t('ai_single_post', 'single')})</option>
          <option value={2}>2</option>
          <option value={3}>3 ({t('ai_recommended', 'recommended')})</option>
          <option value={4}>4</option>
          <option value={5}>5 ({t('ai_max', 'max')})</option>
        </select>
      </div>
      <Button
        loading={isGenerating}
        onClick={() => generate()}
        className="!h-[34px] !text-xs"
      >
        {isGenerating
          ? t('ai_generating', 'Generating…')
          : slidesCount > 1
            ? t('ai_generate_carousel_button', 'Generate carousel ({n})').replace('{n}', String(slidesCount))
            : t('ai_generate_button', 'Generate Design')}
      </Button>
      {confirmPrompt !== null && (
        <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 px-2 py-1.5 flex flex-col gap-1.5">
          <p className="text-[11px] leading-snug text-textColor/80">
            ⚠️{' '}
            {t(
              'ai_replace_confirm',
              'This will replace the design currently on the canvas. Save it to the library first if you want to keep it.'
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => generate(confirmPrompt, true)}
              className="text-[11px] px-2 py-1 rounded bg-newAccent text-[#06222e] font-[600] hover:brightness-110 transition-all"
            >
              {t('ai_replace_confirm_btn', 'Replace & generate')}
            </button>
            <button
              onClick={() => setConfirmPrompt(null)}
              className="text-[11px] px-2 py-1 rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors"
            >
              {t('ai_replace_cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-textColor/65 leading-snug">
        {t(
          'ai_generate_hint',
          'AI generates the background + text in one step. Takes about 5-10 seconds.'
        )}
      </p>
    </div>
  );
};
