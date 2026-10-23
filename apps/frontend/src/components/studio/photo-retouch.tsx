'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';

/**
 * Studio → Photos: the pass a photographer gives every frame before delivery,
 * done for a batch of library photos at once. No sliders: pick how far it may
 * go (Light / Medium / Strong / Black & white), Postra looks at each photo,
 * decides the adjustments and makes a new library file. The original is never
 * touched; hold a result to see it. Plan/photo-retouch.md.
 */

export type RetouchLevel = 'light' | 'medium' | 'strong' | 'bw';

export const MAX_PHOTOS = 10;
// two at a time: a 2048 px photo takes a second or two on the server
const CONCURRENCY = 2;

interface SourceMedia {
  id: string;
  path: string;
  name?: string;
}

interface RetouchResult {
  id: string;
  path: string;
  originalName?: string;
  summary: string;
  fallback: boolean;
  level: RetouchLevel;
}

interface Item {
  key: string;
  source: SourceMedia;
  level: RetouchLevel;
  status: 'queued' | 'working' | 'done' | 'error';
  result?: RetouchResult;
  error?: string;
}

interface Props {
  setMedia: (params: { id: string; path: string }[]) => void;
  closeModal: () => void;
  /** 'composer' offers "Use in post"; 'studio' saves to the library only. */
  mode: 'composer' | 'studio';
  /** Photos to start with (library "Retouch", composer attachment). */
  initial?: SourceMedia[];
  /** A library id to load first (/studio?mode=photo&mediaId=...). */
  loadMediaId?: string;
}

export const PhotoRetouch: FC<Props> = ({
  setMedia,
  closeModal,
  mode,
  initial,
  loadMediaId,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const [level, setLevel] = useState<RetouchLevel>('light');
  const [items, setItems] = useState<Item[]>(() =>
    (initial ?? []).map((source) => ({
      key: source.id,
      source,
      level: 'light',
      status: 'queued',
    }))
  );
  const [running, setRunning] = useState(false);
  const [compare, setCompare] = useState<string | null>(null);
  const loadedRef = useRef<string | undefined>(undefined);

  const levels: { key: RetouchLevel; label: string; hint: string }[] = [
    {
      key: 'light',
      label: t('retouch_level_light', 'Light'),
      hint: t('retouch_level_light_hint', 'The subtle pass every photo gets. Most people will not notice, they will just like the photo more.'),
    },
    {
      key: 'medium',
      label: t('retouch_level_medium', 'Medium'),
      hint: t('retouch_level_medium_hint', 'A visible, natural polish: exposure, colour cast and flat contrast corrected.'),
    },
    {
      key: 'strong',
      label: t('retouch_level_strong', 'Strong'),
      hint: t('retouch_level_strong_hint', 'A confident edit for social media. Still the same real photo.'),
    },
    {
      key: 'bw',
      label: t('retouch_level_bw', 'Black & white'),
      hint: t('retouch_level_bw_hint', 'A balanced monochrome conversion with a touch of contrast.'),
    },
  ];
  const labelOf = (key: RetouchLevel) => levels.find((l) => l.key === key)?.label ?? key;

  const addSources = useCallback(
    (sources: SourceMedia[]) => {
      setItems((current) => {
        const known = new Set(current.map((i) => i.source.id));
        const fresh = sources.filter((s) => !known.has(s.id));
        const room = MAX_PHOTOS - current.length;
        if (fresh.length > room) {
          toaster.show(
            t('retouch_max_photos', 'Up to 10 photos at a time. The extra ones were left out.'),
            'warning'
          );
        }
        return [
          ...current,
          ...fresh.slice(0, Math.max(0, room)).map((source) => ({
            key: source.id,
            source,
            level,
            status: 'queued' as const,
          })),
        ];
      });
    },
    [level, t, toaster]
  );

  // /studio?mode=photo&mediaId=<id>: the library's "Retouch" lands here.
  useEffect(() => {
    if (!loadMediaId || loadedRef.current === loadMediaId) return;
    loadedRef.current = loadMediaId;
    (async () => {
      try {
        const res = await fetch(`/media/${loadMediaId}`);
        if (!res.ok) throw new Error(String(res.status));
        const media = await res.json();
        if (media?.id && media?.path) addSources([{ id: media.id, path: media.path }]);
      } catch {
        toaster.show(t('retouch_load_failed', 'Could not load that photo from your library.'), 'warning');
      }
    })();
  }, [loadMediaId, addSources, fetch, t, toaster]);

  const pickFromLibrary = useCallback(() => {
    modals.openModal({
      title: t('retouch_pick_title', 'Pick photos to retouch'),
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: 'calc(100% - 80px)',
      height: 'calc(100% - 80px)',
      children: (close) => (
        <MediaBox
          type="image"
          setMedia={(picked) => addSources(picked)}
          closeModal={close}
        />
      ),
    });
  }, [modals, addSources, t]);

  const retouchOne = useCallback(
    async (item: Item, at: RetouchLevel): Promise<Item> => {
      try {
        const res = await fetch(`/media/${item.source.id}/retouch`, {
          method: 'POST',
          body: JSON.stringify({ level: at }),
        });
        if (!res.ok) {
          let message = '';
          try {
            message = (await res.json())?.message || '';
          } catch {
            // no body
          }
          throw new Error(message || `HTTP ${res.status}`);
        }
        const result = (await res.json()) as RetouchResult;
        return { ...item, level: at, status: 'done', result, error: undefined };
      } catch (err) {
        return {
          ...item,
          level: at,
          status: 'error',
          error: (err as Error).message || 'failed',
        };
      }
    },
    [fetch]
  );

  const update = (key: string, patch: Partial<Item>) =>
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  /** Run the queue (or one item) at the given level, two at a time. */
  const run = useCallback(
    async (only?: Item, at: RetouchLevel = level) => {
      const targets = only ? [only] : items;
      if (!targets.length || running) return;
      setRunning(true);
      for (const item of targets) update(item.key, { status: 'queued', level: at, error: undefined });
      const queue = [...targets];
      const worker = async () => {
        while (queue.length) {
          const item = queue.shift()!;
          update(item.key, { status: 'working' });
          const next = await retouchOne(item, at);
          update(item.key, next);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      setRunning(false);
    },
    [items, level, retouchOne, running]
  );

  const done = items.filter((i) => i.status === 'done' && i.result);
  const useInPost = () => {
    if (!done.length) return;
    setMedia(done.map((i) => ({ id: i.result!.id, path: i.result!.path })));
    closeModal();
  };

  return (
    <div className="flex flex-col h-full w-full bg-newBgColorInner text-textColor">
      <div className="flex flex-wrap items-start gap-[16px] p-[16px] border-b border-newBorder">
        <div className="flex flex-col gap-[4px] min-w-[240px] flex-1">
          <div className="text-[16px] font-[600]">{t('retouch_title', 'Photo retouch')}</div>
          <div className="text-[12px] text-textColor/60">
            {t(
              'retouch_intro',
              'Pick up to 10 photos. Postra looks at each one and gives it the light touch a photographer gives every frame. Your originals stay as they are; every result is a new file in your library.'
            )}
          </div>
        </div>
        <div className="flex gap-[8px]">
          <button
            type="button"
            onClick={pickFromLibrary}
            disabled={running || items.length >= MAX_PHOTOS}
            className="h-9 px-4 text-sm rounded-lg border border-newBorder bg-newColColor hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('retouch_add_photos', 'Add photos')}
          </button>
          <button
            type="button"
            onClick={() => run()}
            disabled={running || !items.length}
            className="h-9 px-4 text-sm rounded-lg bg-newAccent text-[#06222e] font-[600] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running
              ? t('retouch_working', 'Retouching...')
              : items.some((i) => i.status === 'done')
              ? t('retouch_again_all', 'Retouch all again')
              : t('retouch_all', 'Retouch all')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-[8px] px-[16px] py-[12px] border-b border-newBorder" role="radiogroup" aria-label={t('retouch_level_label', 'How far to go')}>
        {levels.map((l) => (
          <button
            key={l.key}
            type="button"
            role="radio"
            aria-checked={level === l.key}
            title={l.hint}
            onClick={() => setLevel(l.key)}
            disabled={running}
            className={clsx(
              'flex flex-col items-start gap-[2px] px-[12px] py-[8px] rounded-lg border text-left max-w-[220px] transition-colors',
              level === l.key
                ? 'border-newAccent bg-newAccent/10'
                : 'border-newBorder bg-newColColor hover:bg-white/[0.08]'
            )}
          >
            <span className="text-sm font-[600]">{l.label}</span>
            <span className="text-[11px] text-textColor/60 leading-snug">{l.hint}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-[16px]">
        {!items.length ? (
          <div className="h-full flex flex-col items-center justify-center gap-[12px] text-center text-textColor/60">
            <StudioIcon name="photos" size={40} />
            <div className="text-sm max-w-[420px]">
              {t(
                'retouch_empty',
                'No photos yet. Add some from your library (you can upload there too), pick how far to go, then Retouch all.'
              )}
            </div>
            <button
              type="button"
              onClick={pickFromLibrary}
              className="h-9 px-4 text-sm rounded-lg bg-newAccent text-[#06222e] font-[600]"
            >
              {t('retouch_add_photos', 'Add photos')}
            </button>
          </div>
        ) : (
          <div className="grid gap-[12px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {items.map((item) => {
              const showing = compare === item.key || !item.result ? item.source.path : item.result.path;
              return (
                <div
                  key={item.key}
                  className="flex flex-col rounded-lg border border-newBorder bg-newColColor overflow-hidden"
                  data-testid="retouch-item"
                  data-status={item.status}
                >
                  <div
                    className="relative aspect-[4/3] bg-black/40 select-none"
                    onPointerDown={() => item.result && setCompare(item.key)}
                    onPointerUp={() => setCompare(null)}
                    onPointerLeave={() => setCompare(null)}
                    title={item.result ? t('retouch_hold_hint', 'Hold to see the original') : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={showing} alt="" className="w-full h-full object-contain" draggable={false} />
                    <div className="absolute top-[6px] left-[6px] flex gap-[4px]">
                      {item.status === 'working' && (
                        <span className="px-[6px] py-[2px] rounded bg-black/70 text-white text-[10px] animate-pulse">
                          {t('retouch_status_working', 'Retouching')}
                        </span>
                      )}
                      {item.status === 'done' && (
                        <span
                          data-testid="retouch-level-badge"
                          className="px-[6px] py-[2px] rounded bg-newAccent text-[#06222e] text-[10px] font-[600]"
                        >
                          {compare === item.key
                            ? t('retouch_status_original', 'Original')
                            : labelOf(item.level)}
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span className="px-[6px] py-[2px] rounded bg-red-600 text-white text-[10px]">
                          {t('retouch_status_failed', 'Failed')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-[6px] p-[8px]">
                    <div className="text-[11px] text-textColor/70 min-h-[28px] leading-snug">
                      {item.status === 'done' && item.result
                        ? item.result.summary
                        : item.status === 'error'
                        ? t('retouch_failed', "We couldn't retouch this photo. The original is untouched.")
                        : item.status === 'working'
                        ? t('retouch_status_working_hint', 'Looking at the photo and applying the adjustments...')
                        : t('retouch_status_queued', 'Ready to retouch')}
                    </div>
                    {item.result?.fallback && (
                      <div className="text-[10px] text-textColor/50">
                        {t('retouch_fallback_note', 'Done without AI this time (it was not available), so only the basics were corrected.')}
                      </div>
                    )}
                    <div className="flex items-center gap-[6px]">
                      <select
                        aria-label={t('retouch_level_label', 'How far to go')}
                        value={item.level}
                        disabled={running}
                        onChange={(e) => run(item, e.target.value as RetouchLevel)}
                        className="h-7 text-[11px] rounded border border-newBorder bg-newBgColorInner px-[4px]"
                      >
                        {levels.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                      {item.status === 'done' || item.status === 'error' ? (
                        <button
                          type="button"
                          disabled={running}
                          onClick={() => run(item, item.level)}
                          className="h-7 px-[8px] text-[11px] rounded border border-newBorder hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          {t('retouch_again', 'Retouch again')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => setItems((c) => c.filter((i) => i.key !== item.key))}
                        className="h-7 px-[8px] text-[11px] rounded border border-newBorder hover:bg-white/[0.08] disabled:opacity-50 ms-auto"
                        aria-label={t('retouch_remove', 'Remove from this batch')}
                        title={t('retouch_remove', 'Remove from this batch')}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-[12px] p-[12px] border-t border-newBorder text-[12px] text-textColor/60">
        {done.length > 0 && (
          <span>
            {t('retouch_saved_note', 'Every retouched photo is already in your Media library.')}
          </span>
        )}
        {mode === 'composer' ? (
          <button
            type="button"
            onClick={useInPost}
            disabled={!done.length || running}
            className="ms-auto h-9 px-4 text-sm rounded-lg bg-newAccent text-[#06222e] font-[600] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('retouch_use_in_post', 'Use in post')}
          </button>
        ) : (
          done.length > 0 && (
            <a href="/media" className="ms-auto underline hover:text-textColor">
              {t('retouch_open_media', 'Open Media')}
            </a>
          )
        )}
      </div>
    </div>
  );
};
