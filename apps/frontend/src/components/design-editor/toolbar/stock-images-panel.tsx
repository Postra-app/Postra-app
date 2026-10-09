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
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { EmptyState } from '@gitroom/frontend/components/ui/empty-state';
import { Skeleton } from '@gitroom/frontend/components/ui/skeleton';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';
import useSWR from 'swr';

type StockSource = 'pixabay' | 'pexels' | 'unsplash';

const SOURCE_NAME: Record<StockSource, string> = {
  pixabay: 'Pixabay',
  pexels: 'Pexels',
  unsplash: 'Unsplash',
};

// One shape for both libraries.
interface StockImageHit {
  id: number | string;
  previewURL: string;
  importURL: string;
  alt: string;
  user: string;
  userURL?: string;
  pageURL: string;
  // Unsplash: where to report the download (its API terms).
  downloadLocation?: string;
}

const toHit = (source: StockSource, h: any): StockImageHit =>
  source !== 'pixabay'
    ? h
    : {
        id: h.id,
        previewURL: h.previewURL,
        importURL: h.webformatURL,
        alt: h.tags,
        user: h.user,
        pageURL: h.pageURL,
      };

interface Props {
  canvas: MutableRefObject<fabric.Canvas | null>;
  /**
   * Run this search once on mount so the panel opens with photos in it. An
   * empty grid asking for a query is the reason nobody found stock: the user
   * has to guess that anything is behind it before they see a single result.
   */
  defaultQuery?: string;
}

// Free stock photos from Pixabay, Pexels or Unsplash, imported to the media
// library on click and dropped onto the canvas. Saves an AI credit every time
// a stock photo does the job instead of generating one. Pexels and Unsplash
// ask for a visible credit to the photographer and to them.
export const StockImagesPanel: FC<Props> = ({ canvas, defaultQuery }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<StockSource>('pixabay');
  const [hits, setHits] = useState<StockImageHit[]>([]);
  // Pexels shows up once its key is set on the server.
  const { data: sources } = useSWR('stock-sources', async () =>
    (await fetch('/media/stock-sources')).json()
  );
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [importingId, setImportingId] = useState<number | string | null>(null);

  // The newest search wins: one typed while another runs (switching the
  // source starts one) used to be dropped, and the late answer of the older
  // one must not replace the newer.
  const latest = useRef(0);
  const search = useCallback(
    async (term?: string, from: StockSource = source) => {
    const q = (term ?? query).trim();
    if (!q) return;
    const request = ++latest.current;
    setSearching(true);
    try {
      const res = await fetch(
        `/media/${from}-images?q=${encodeURIComponent(q)}`
      );
      if (!res.ok) throw new Error(`search ${res.status}`);
      const data = await res.json();
      if (request !== latest.current) return;
      setHits((data?.hits ?? []).map((h: any) => toHit(from, h)));
      setSearched(true);
    } catch {
      if (request !== latest.current) return;
      toaster.show(
        t('image_stock_search_failed', 'Image search failed.'),
        'warning'
      );
    } finally {
      if (request === latest.current) setSearching(false);
    }
    },
    [query, source, fetch, toaster, t]
  );

  const switchSource = useCallback(
    (next: StockSource) => {
      if (next === source) return;
      setSource(next);
      setHits([]);
      setSearched(false);
      if (query.trim()) search(query, next);
    },
    [source, query, search]
  );

  // Fire the default search once, not on every re-render and not twice under
  // StrictMode's double mount — a wasted Pixabay call per keystroke elsewhere
  // in the panel would be easy to introduce here.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!defaultQuery || autoRan.current) return;
    autoRan.current = true;
    setQuery(defaultQuery);
    search(defaultQuery);
  }, [defaultQuery, search]);

  const addToCanvas = useCallback(
    (path: string) => {
      const imgEl = new Image();
      imgEl.crossOrigin = 'anonymous';
      imgEl.onload = () => {
        if (!canvas.current) return;
        const img = new fabric.FabricImage(imgEl);
        const canvasW = canvas.current.getWidth() / canvas.current.getZoom();
        const canvasH = canvas.current.getHeight() / canvas.current.getZoom();
        const scale = Math.min(canvasW / img.width!, canvasH / img.height!, 1);
        img.set({
          scaleX: scale,
          scaleY: scale,
          left: canvasW / 2,
          top: canvasH / 2,
          // Anchor the CENTRE at canvas centre — with the default left/top
          // origin the photo's corner sat at the centre and the image hung
          // off into the bottom-right quadrant.
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
        });
        canvas.current.add(img);
        canvas.current.setActiveObject(img);
        canvas.current.renderAll();
      };
      imgEl.onerror = () =>
        toaster.show(t('image_load_failed', 'Failed to load image'), 'warning');
      imgEl.src = path;
    },
    [canvas, toaster, t]
  );

  const importImage = useCallback(
    async (hit: StockImageHit) => {
      if (importingId) return;
      setImportingId(hit.id);
      try {
        const res = await fetch(`/media/${source}-images/import`, {
          method: 'POST',
          body: JSON.stringify({
            url: hit.importURL,
            sourceId: hit.id,
            downloadLocation: hit.downloadLocation,
          }),
        });
        if (!res.ok) throw new Error(`import ${res.status}`);
        const media = await res.json();
        if (!media?.path) throw new Error('no path');
        addToCanvas(media.path);
      } catch {
        toaster.show(
          t('image_stock_import_failed', 'Image import failed.'),
          'warning'
        );
      } finally {
        setImportingId(null);
      }
    },
    [importingId, source, fetch, addToCanvas, toaster, t]
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
        {t('image_stock_title', 'Stock photos')}
      </span>
      {(!!sources?.pexels || !!sources?.unsplash) && (
        <div className="flex gap-1" role="group" aria-label={t('stock_source', 'Photo library')}>
          {(['pixabay', 'unsplash', 'pexels'] as const)
            .filter((s) => s === 'pixabay' || !!sources?.[s])
            .map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={source === s}
              onClick={() => switchSource(s)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                source === s
                  ? 'border-forth text-textColor bg-white/[0.06]'
                  : 'border-newBorder text-textColor/70 hover:text-textColor'
              }`}
            >
              {SOURCE_NAME[s]}
            </button>
          ))}
        </div>
      )}
      {/* Both APIs ask that results say where they came from, wherever they
          are shown — a hover title alone is not read by anybody. */}
      {source === 'pixabay' ? (
        <p className="text-[11px] text-textColor/65 leading-snug">
          {t(
            'image_stock_source',
            'Free photos from Pixabay - commercial use, no credit needed.'
          )}{' '}
          <a
            href="https://pixabay.com/service/license-summary/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-newAccent hover:underline"
          >
            {t('video_stock_license', 'Pixabay License')} ↗
          </a>
        </p>
      ) : source === 'unsplash' ? (
        <p className="text-[11px] text-textColor/65 leading-snug">
          <a
            href="https://unsplash.com/?utm_source=postra&utm_medium=referral"
            target="_blank"
            rel="noopener noreferrer"
            className="text-newAccent hover:underline"
          >
            {t('image_stock_unsplash_source', 'Photos from Unsplash')} ↗
          </a>{' '}
          {t('image_stock_pexels_licence', '- free to use, commercial use OK.')}
        </p>
      ) : (
        <p className="text-[11px] text-textColor/65 leading-snug">
          <a
            href="https://www.pexels.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-newAccent hover:underline"
          >
            {t('image_stock_pexels_source', 'Photos provided by Pexels')} ↗
          </a>{' '}
          {t('image_stock_pexels_licence', '- free to use, commercial use OK.')}
        </p>
      )}
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder={t('image_stock_search_ph', 'e.g. coffee, office, summer')}
          className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/60 focus:outline-none focus:border-forth"
        />
        <button
          onClick={() => search()}
          disabled={searching || !query.trim()}
          className="text-xs px-2.5 py-1.5 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors disabled:opacity-50"
        >
          {searching ? '…' : t('video_stock_search', 'Search')}
        </button>
      </div>

      {hits.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {hits.map((hit) => (
            <div key={hit.id} className="flex flex-col gap-0.5 min-w-0">
              <button
                onClick={() => importImage(hit)}
                disabled={importingId !== null}
                title={`${hit.alt} - ${hit.user} (${SOURCE_NAME[source]})`}
                className="relative aspect-square rounded overflow-hidden border border-newBorder/50 hover:border-forth transition-colors disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={hit.previewURL}
                  alt={hit.alt}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                {importingId === hit.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[11px] text-white">
                    {t('video_stock_importing', 'Downloading…')}
                  </span>
                )}
              </button>
              {source === 'pexels' && (
                <a
                  href={hit.userURL || hit.pageURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-textColor/60 hover:underline truncate"
                >
                  {t('image_stock_pexels_credit', 'Photo by {{user}} on Pexels', { user: hit.user })}
                </a>
              )}
              {source === 'unsplash' && (
                // Unsplash: the photographer and Unsplash, each linked.
                <span className="text-[10px] text-textColor/60 truncate">
                  {t('image_stock_photo_by', 'Photo by')}{' '}
                  <a href={hit.userURL} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {hit.user}
                  </a>{' '}
                  {t('image_stock_on', 'on')}{' '}
                  <a href={hit.pageURL} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    Unsplash
                  </a>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {searching && (
        <div className="grid grid-cols-2 gap-1.5" role="status">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      )}

      {searched && !searching && hits.length === 0 && (
        <EmptyState
          className="py-[20px] gap-[6px]"
          icon={<StudioIcon name="stock" size={28} />}
          title={t('stock_none_title', 'No photos for that search')}
          description={t(
            'stock_none_hint',
            'Try a plainer word - "coffee" finds more than "coffee shop interior".'
          )}
        />
      )}

      <p className="text-[11px] text-textColor/65 leading-snug">
        {t(
          'image_stock_hint',
          'Click a photo to add it to the canvas - it is also saved to your media library.'
        )}
      </p>
    </div>
  );
};
