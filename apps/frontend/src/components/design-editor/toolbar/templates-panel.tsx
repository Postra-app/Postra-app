'use client';

import { FC, MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as fabric from 'fabric';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useEditorStore } from '../editor.store';
import { useBrandKit } from '@gitroom/frontend/components/video-studio/use-brand-kit';
import {
  BUILT_IN_TEMPLATES,
  applyTemplate,
} from '../templates/built-in-templates';
import {
  renderTemplateThumbnail,
  templateThumbnailKey,
} from '../templates/template-thumbnails';
import {
  TEMPLATE_CATEGORIES,
  TemplateCategory,
  TemplateLang,
  DEFAULT_BRAND,
  BrandStyle,
} from '../templates/template-types';
import { withHistoryPaused } from '../utils/canvas-history';

interface TemplatesPanelProps {
  canvas: MutableRefObject<fabric.Canvas | null>;
}

const SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_LEN = 3;

export const TemplatesPanel: FC<TemplatesPanelProps> = ({ canvas }) => {
  const t = useT();
  const { i18n } = useTranslation();
  const isPl = (i18n.resolvedLanguage ?? i18n.language ?? '')
    .toLowerCase()
    .startsWith('pl');
  const lang: TemplateLang = isPl ? 'pl' : 'en';
  const toaster = useToaster();
  const fetch = useFetch();
  const { platform } = useEditorStore();
  // Templates render in the org's own colours/font the moment a Brand Kit is
  // saved — that's the whole point of "template in your brand". Without a
  // saved kit they fall back to the Postra default palette.
  const { kit, exists: brandExists } = useBrandKit();
  const brand: BrandStyle = useMemo(
    () =>
      brandExists
        ? {
            primary: kit.primaryColor,
            background: kit.secondaryColor,
            text: kit.textColor,
            fontFamily: `${kit.font}, system-ui, sans-serif`,
          }
        : DEFAULT_BRAND,
    [brandExists, kit]
  );
  const [category, setCategory] = useState<TemplateCategory>('promo');
  const [query, setQuery] = useState('');
  const { pendingTemplateQuery, setPendingTemplateQuery } = useEditorStore();

  // Consume a query handed over by another panel (occasion chips on the free
  // plan) exactly once, then clear it — otherwise re-opening Templates later
  // would silently re-apply a search the user has already moved on from.
  useEffect(() => {
    if (!pendingTemplateQuery) return;
    setQuery(pendingTemplateQuery);
    setPendingTemplateQuery(null);
  }, [pendingTemplateQuery, setPendingTemplateQuery]);
  const [searchHits, setSearchHits] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);
  const [myTemplates, setMyTemplates] = useState<
    { id: string; name: string; path: string }[]
  >([]);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/media/my-templates');
        if (!res.ok) return;
        const list = await res.json();
        if (!cancelled && Array.isArray(list)) setMyTemplates(list);
      } catch {
        // panel still works with built-ins only
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyMyTemplate = useCallback(
    async (id: string) => {
      if (!canvas.current || applyingId) return;
      setApplyingId(id);
      try {
        const data = await (await fetch(`/media/${id}`)).json();
        if (!data?.canvasJson || !canvas.current) {
          toaster.show(
            t('template_apply_failed', 'Failed to apply template'),
            'warning'
          );
          return;
        }
        // loadFromJSON clears and re-adds, firing an event per object — that
        // is what buried the pre-template canvas under a dozen undo steps.
        await withHistoryPaused(canvas.current, async () => {
          await canvas.current!.loadFromJSON(data.canvasJson);
          canvas.current!.renderAll();
        });
      } catch {
        toaster.show(
          t('template_apply_failed', 'Failed to apply template'),
          'warning'
        );
      } finally {
        setApplyingId(null);
      }
    },
    [canvas, fetch, applyingId, t, toaster]
  );

  const removeMyTemplate = useCallback(
    async (id: string) => {
      try {
        await fetch(`/media/${id}/template`, {
          method: 'PUT',
          body: JSON.stringify({ isTemplate: false }),
        });
        setMyTemplates((prev) => prev.filter((m) => m.id !== id));
      } catch {
        toaster.show(
          t('template_remove_failed', 'Failed to remove the template.'),
          'warning'
        );
      }
    },
    [fetch, t, toaster]
  );

  useEffect(() => {
    if (query.trim().length < MIN_SEARCH_LEN) {
      setSearchHits(null);
      searchAbort.current?.abort();
      return;
    }
    const ctrl = new AbortController();
    searchAbort.current?.abort();
    searchAbort.current = ctrl;
    const id = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch('/media/search-templates', {
          method: 'POST',
          signal: ctrl.signal,
          body: JSON.stringify({
            query: query.trim(),
            templates: BUILT_IN_TEMPLATES.map((tpl) => ({
              id: tpl.key,
              text: isPl
                ? `${tpl.labelPl}. ${tpl.descriptionPl}. Kategoria: ${tpl.category}.`
                : `${tpl.label}. ${tpl.description}. Category: ${tpl.category}.`,
            })),
          }),
        });
        if (!res.ok) {
          setSearchHits([]);
          return;
        }
        const hits = (await res.json()) as { id: string; score: number }[];
        setSearchHits(hits.filter((h) => h.score > 0.2).map((h) => h.id));
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setSearchHits([]);
        }
      } finally {
        if (searchAbort.current === ctrl) searchAbort.current = null;
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(id);
      ctrl.abort();
    };
  }, [query, fetch, isPl]);

  useEffect(() => () => searchAbort.current?.abort(), []);

  const filtered = useMemo(() => {
    if (searchHits) {
      const set = new Set(searchHits);
      return searchHits
        .map((id) => BUILT_IN_TEMPLATES.find((tpl) => tpl.key === id))
        .filter((tpl): tpl is (typeof BUILT_IN_TEMPLATES)[number] => !!tpl && set.has(tpl.key));
    }
    return BUILT_IN_TEMPLATES.filter((tpl) => tpl.category === category);
  }, [category, searchHits]);

  // Offscreen-rendered previews of the visible templates, in the org's brand
  // colours. Generated one per tick so opening the panel never freezes it;
  // the module cache makes revisits instant.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await document.fonts?.ready;
      for (const tpl of filtered) {
        if (cancelled) return;
        const key = templateThumbnailKey(tpl, platform, brand, lang);
        try {
          const url = renderTemplateThumbnail(tpl, platform, brand, lang);
          setThumbs((prev) => (prev[key] ? prev : { ...prev, [key]: url }));
        } catch {
          // a template that fails to render just keeps its text-only card
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filtered, platform, brand, lang]);

  const handleApply = useCallback(
    async (templateKey: string) => {
      if (!canvas.current) return;
      const tpl = BUILT_IN_TEMPLATES.find((t) => t.key === templateKey);
      if (!tpl) return;

      try {
        // A template adds its objects one at a time; without pausing, each
        // one became its own undo step and "undo with Ctrl+Z" was a lie.
        const keptPhoto = await withHistoryPaused(canvas.current, () =>
          applyTemplate(tpl, canvas.current!, platform, brand, lang)
        );
        if (keptPhoto) {
          toaster.show(
            t(
              'template_kept_photo',
              'Template applied on your photo — undo with Ctrl+Z for a clean slate.'
            ),
            'success'
          );
        }
      } catch {
        toaster.show(
          t('template_apply_failed', 'Failed to apply template'),
          'warning'
        );
      }
    },
    [canvas, platform, t, toaster, lang, brand]
  );

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t(
          'template_search_placeholder',
          '🔍 Search templates (e.g. "holiday promo")'
        )}
        className="text-xs px-2 py-1.5 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/40 focus:outline-none focus:border-forth"
      />
      {!searchHits && myTemplates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-textColor/50">
            ⭐ {t('my_templates', 'Your templates')}
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {myTemplates.map((m) => (
              <div key={m.id} className="relative group">
                <button
                  onClick={() => applyMyTemplate(m.id)}
                  disabled={!!applyingId}
                  title={t('my_template_apply_hint', 'Apply this template (replaces the canvas — undo with Ctrl+Z)')}
                  className="w-full rounded overflow-hidden border border-newBorder/60 hover:border-forth transition-colors disabled:opacity-50 bg-newColColor"
                >
                  <img
                    src={m.path}
                    alt={m.name}
                    loading="lazy"
                    className="w-full h-16 object-cover"
                  />
                </button>
                {applyingId === m.id && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] bg-black/50 text-white rounded">
                    {t('template_applying', 'Applying…')}
                  </span>
                )}
                <button
                  onClick={() => removeMyTemplate(m.id)}
                  title={t('my_template_remove_hint', 'Remove from templates (the image stays in your library)')}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[9px] leading-4 text-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!searchHits && (
        <div className="flex flex-wrap gap-1">
          {TEMPLATE_CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={clsx(
                'text-[10px] px-2 py-1 rounded transition-colors',
                category === c.key
                  ? 'bg-forth text-white'
                  : 'bg-newColColor text-textColor/70 hover:text-textColor'
              )}
              title={t(c.labelKey, c.fallback)}
            >
              {c.emoji} {t(c.labelKey, c.fallback)}
            </button>
          ))}
        </div>
      )}
      {searching && (
        <div className="text-[10px] text-textColor/50">
          {t('template_searching', 'Searching…')}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {filtered.length === 0 && (
          <div className="col-span-2 text-center text-[11px] text-textColor/50 py-4">
            {t('template_coming_soon', 'More templates coming soon in this category')}
          </div>
        )}
        {filtered.map((tpl) => {
          const thumb = thumbs[templateThumbnailKey(tpl, platform, brand, lang)];
          return (
            <button
              key={tpl.key}
              onClick={() => handleApply(tpl.key)}
              title={isPl ? tpl.descriptionPl : tpl.description}
              className="text-left rounded overflow-hidden bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors border border-newBorder/60 hover:border-forth"
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt={isPl ? tpl.labelPl : tpl.label}
                  className="w-full block"
                />
              ) : (
                <div
                  className="w-full bg-white/5 animate-pulse"
                  style={{
                    aspectRatio: `${platform.width} / ${platform.height}`,
                  }}
                />
              )}
              <div className="text-[10px] font-semibold px-1.5 py-1 leading-tight">
                {isPl ? tpl.labelPl : tpl.label}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-textColor/40 leading-snug">
        {t(
          'template_hint',
          'A template overwrites the current canvas (undo with Ctrl+Z). Colours come from your Brand Kit — and every element stays editable: select it to change its colour, text or size.'
        )}
      </p>
    </div>
  );
};
