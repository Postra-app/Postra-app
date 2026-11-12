'use client';

import { FC, MutableRefObject, useCallback, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../editor.store';
import { useCarouselStore, CarouselSlide } from '../carousel.store';
import { renderDesignSpec, PostDesignSpec } from '../utils/canvas-renderer';
import { withHistoryPaused } from '../utils/canvas-history';
import { reusedBackground } from '../utils/reused-background';
import { useHolidays, getUpcomingHolidays } from '../utils/holidays';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { isFetchHandledError } from '@gitroom/helpers/utils/fetch.errors';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useTranslation } from 'react-i18next';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useBrandKit } from '@gitroom/frontend/components/video-studio/use-brand-kit';
import { loadCanvasFonts } from '../utils/font-loading';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';
import { useAiError } from '@gitroom/frontend/components/ai/use-ai-error';

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
  const showAiError = useAiError();
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
  const [slidesCount, setSlidesCount] = useState(1);
  // An article to build the design from; the prompt then becomes a note.
  const [sourceUrl, setSourceUrl] = useState('');
  // Prompt parked while the user decides whether to replace a non-empty canvas.
  const [confirmPrompt, setConfirmPrompt] = useState<{ prompt: string; link: string } | null>(null);

  // No abort when the panel closes: the credit is spent on the server either
  // way, so a design asked for and paid for still lands on the canvas when the
  // user looks at another panel meanwhile. `isGenerating` lives in the store,
  // so the panel shows the run again when it is reopened.

  // promptOverride lets the occasion chips generate in one click — the chip
  // passes its prompt directly because setAiPrompt hasn't re-rendered yet.
  const generate = useCallback(async (promptOverride?: string, skipConfirm = false, linkOverride?: string) => {
    const prompt = (promptOverride ?? aiPrompt).trim();
    // An occasion chip is its own brief and passes '' here: the link belongs
    // to the typed prompt.
    const link = (linkOverride ?? sourceUrl).trim();
    if (!canvas.current || isGenerating) return;
    if (!prompt && !link) {
      toaster.show(t('ai_prompt_required', 'Describe what you want to generate'), 'warning');
      return;
    }
    if (link && !/^https:\/\/[^\s.]+\.[^\s]+$/i.test(link)) {
      toaster.show(
        t('ai_source_url_invalid', 'Enter a full link that starts with https://'),
        'warning'
      );
      return;
    }
    if (prompt && prompt.length < 3) {
      toaster.show(t('ai_prompt_required', 'Describe what you want to generate'), 'warning');
      return;
    }

    // Generation replaces the whole canvas — if there's work on it, ask first.
    if (!skipConfirm && canvas.current.getObjects().length > 0) {
      setConfirmPrompt({ prompt, link });
      return;
    }
    setConfirmPrompt(null);

    setGenerating(true);
    try {
      const isCarousel = slidesCount > 1;
      // On-image text follows the PROMPT's language, with the app language as
      // a fallback for a prompt too short to tell. Sending the locale as the
      // target (what this used to do) put English text on a Polish prompt
      // whenever the UI happened to be English. The brand-kit tone can no
      // longer tip the language either — the prompt rule rules that out.
      const languageFallback = (i18n.resolvedLanguage ?? i18n.language ?? 'en')
        .toLowerCase()
        .startsWith('pl')
        ? 'Polish'
        : 'English';
      const brief = {
        ...(prompt ? { prompt } : {}),
        ...(link ? { sourceUrl: link } : {}),
      };
      const res = isCarousel
        ? await fetch('/media/generate-carousel-design', {
            method: 'POST',
            body: JSON.stringify({
              ...brief,
              platform: platform.key,
              slidesCount,
              languageFallback,
            }),
          })
        : await fetch('/media/generate-post-design', {
            method: 'POST',
            body: JSON.stringify({
              ...brief,
              platform: platform.key,
              languageFallback,
            }),
          });

      if (!res.ok) {
        // One contract for every AI failure in the app, and the only branch
        // that can be reached here: the shared fetch wrapper turns 403, 429 and
        // 5xx into a handled error before this line, and reports 402 itself.
        await showAiError(
          res,
          t(
            'ai_generate_failed',
            'AI generation failed. Try a different prompt or check your connection.'
          )
        );
        return;
      }

      const data = await res.json();
      // Studio itself may have been closed while the design was being made.
      const c = canvas.current;
      if (!c) return;

      if (reusedBackground(data, isCarousel)) {
        toaster.show(
          t(
            'ai_background_reused',
            'Reused a background from an identical prompt - no image credit used.'
          ),
          'success'
        );
      }

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
        await withHistoryPaused(c, async () => {
          for (let i = 0; i < slideSpecs.length; i += 1) {
            await renderDesignSpec(c, slideSpecs[i], platform);
            slides.push({
              id: `slide-${Date.now().toString(36)}-${i}`,
              canvasJson: JSON.stringify(c.toJSON()),
            });
          }
          useCarouselStore.getState().replaceAllSlides(slides);
          // The loop leaves the canvas on the LAST slide, but the strip activates
          // slide 1 — reload slide 1 so the canvas matches the highlighted thumbnail
          // (otherwise clicking thumbnail 1 is a no-op and the canvas looks stuck).
          await c.loadFromJSON(slides[0].canvasJson!);
          await loadCanvasFonts(c);
          c.renderAll();
        });
      } else {
        const spec = data as PostDesignSpec;
        await withHistoryPaused(c, () =>
          renderDesignSpec(c, spec, platform)
        );
      }
    } catch (err) {
      // A globally-handled status (5xx/429/401) already showed its own message.
      // Telling the user to "try a different prompt" during a backend restart
      // sends them off rewriting perfectly good input.
      if (isFetchHandledError(err)) return;
      toaster.show(
        t('ai_generate_failed', 'AI generation failed. Try a different prompt or check your connection.'),
        'warning'
      );
    } finally {
      setGenerating(false);
    }
  }, [canvas, aiPrompt, platform, isGenerating, fetch, toaster, t, setGenerating, slidesCount, i18n, sourceUrl]);

  if (!allowed) {
    return (
      <div className="flex flex-col gap-2 text-[11px] text-textColor/60 leading-relaxed">
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
                'Opens Templates filtered for the occasion - free on every plan.'
              )}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!brandKit.loading && !brandKit.exists && (
        <div className="rounded-md bg-forth/10 border border-forth/30 px-2 py-1.5 flex flex-col gap-1.5">
          <p className="text-[11px] leading-snug text-textColor/80">
            {t(
              'brand_kit_nudge',
              'Set up your Brand Kit once - AI writes in your tone, designs come out in your colours and font, and your logo goes on every generated design.'
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
                      generate(occasionPrompt, false, '');
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
                    <StudioIcon name="edit" size={13} />
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-textColor/65 leading-snug">
            {t(
              'holiday_or_custom',
              'Click an occasion to generate instantly, or use the pencil to fill the prompt and edit it first. You can also type your own idea below.'
            )}
          </p>
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-textColor/60">
          {t('ai_source_url_label', 'From a link (optional)')}
        </span>
        <input
          type="url"
          inputMode="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder={t('ai_source_url_placeholder', 'https://your-site.com/blog/article')}
          disabled={isGenerating}
          maxLength={2000}
          className="text-xs p-2 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/60 focus:outline-none focus:border-forth disabled:opacity-50"
        />
        <span className="text-[11px] text-textColor/65 leading-snug normal-case">
          {t(
            'ai_source_url_hint',
            'Paste a blog post or article and AI turns it into slides. Use the box below to say what to focus on.'
          )}
        </span>
      </label>
      <textarea
        value={aiPrompt}
        onChange={(e) => setAiPrompt(e.target.value)}
        placeholder={t(
          'ai_prompt_placeholder',
          'e.g. Summer sale -50% at a clothing store'
        )}
        rows={4}
        disabled={isGenerating}
        className="text-xs p-2 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/60 resize-none focus:outline-none focus:border-forth disabled:opacity-50"
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
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-textColor/80">
            <StudioIcon name="warning" size={13} className="mt-[2px] shrink-0" />
            {t(
              'ai_replace_confirm',
              'This will replace the design currently on the canvas. Save it to the library first if you want to keep it.'
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => generate(confirmPrompt.prompt, true, confirmPrompt.link)}
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
          'AI generates the background + text in one step. Takes about 30 seconds.'
        )}
      </p>
    </div>
  );
};
