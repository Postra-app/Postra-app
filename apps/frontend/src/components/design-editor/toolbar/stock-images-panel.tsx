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

interface PixabayImageHit {
  id: number;
  previewURL: string;
  webformatURL: string;
  tags: string;
  user: string;
  pageURL: string;
}

interface Props {
  canvas: MutableRefObject<fabric.Canvas | null>;
  /**
   * Run this search once on mount so the panel opens with photos in it. An
   * empty grid asking for a query is the reason nobody found stock: the user
   * has to guess that anything is behind it before they see a single result.
   */
  defaultQuery?: string;
}

// Free stock photos from Pixabay, imported to the media library on click
// (Pixabay TOS forbids hotlinking) and dropped onto the canvas. Saves an AI
// credit every time a stock photo does the job instead of generating one.
export const StockImagesPanel: FC<Props> = ({ canvas, defaultQuery }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PixabayImageHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);

  const search = useCallback(
    async (term?: string) => {
    const q = (term ?? query).trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/media/pixabay-images?q=${encodeURIComponent(q)}`
      );
      if (!res.ok) throw new Error(`search ${res.status}`);
      const data = await res.json();
      setHits((data?.hits ?? []) as PixabayImageHit[]);
      setSearched(true);
    } catch {
      toaster.show(
        t('image_stock_search_failed', 'Image search failed.'),
        'warning'
      );
    } finally {
      setSearching(false);
    }
    },
    [query, searching, fetch, toaster, t]
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
    async (hit: PixabayImageHit) => {
      if (importingId) return;
      setImportingId(hit.id);
      try {
        const res = await fetch('/media/pixabay-images/import', {
          method: 'POST',
          body: JSON.stringify({ url: hit.webformatURL, sourceId: hit.id }),
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
    [importingId, fetch, addToCanvas, toaster, t]
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] text-textColor/60 uppercase tracking-wide">
        {t('image_stock_title', 'Stock photos')}
      </span>
      {/* Pixabay's API terms ask that results say where they came from,
          wherever they are shown. The video panel does; here the only credit
          was a hover title, which nobody reads. */}
      <p className="text-[10px] text-textColor/50 leading-snug">
        {t(
          'image_stock_source',
          'Free photos from Pixabay — commercial use, no credit needed.'
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
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder={t('image_stock_search_ph', 'e.g. coffee, office, summer')}
          className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/40 focus:outline-none focus:border-forth"
        />
        <button
          onClick={() => search()}
          disabled={searching || !query.trim()}
          className="text-xs px-2.5 py-1.5 rounded bg-newColColor hover:bg-forth text-textColor transition-colors disabled:opacity-50"
        >
          {searching ? '…' : t('video_stock_search', 'Search')}
        </button>
      </div>

      {hits.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {hits.map((hit) => (
            <button
              key={hit.id}
              onClick={() => importImage(hit)}
              disabled={importingId !== null}
              title={`${hit.tags} — ${hit.user} (Pixabay)`}
              className="relative aspect-square rounded overflow-hidden border border-newBorder/50 hover:border-forth transition-colors disabled:opacity-60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hit.previewURL}
                alt={hit.tags}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              {importingId === hit.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] text-white">
                  {t('video_stock_importing', 'Downloading…')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {searched && !searching && hits.length === 0 && (
        <p className="text-[10px] text-textColor/40">
          {t('icon_no_results', 'No results')}
        </p>
      )}

      <p className="text-[10px] text-textColor/40 leading-snug">
        {t(
          'image_stock_hint',
          'Free photos (Pixabay License, commercial use OK). Click a photo to add it to the canvas — it is also saved to your media library.'
        )}
      </p>
    </div>
  );
};
