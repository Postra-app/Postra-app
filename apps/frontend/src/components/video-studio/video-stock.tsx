'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/frontend/components/ui/button';

interface PixabayVideoSize {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail: string;
}

export interface PixabayVideo {
  id: number;
  duration: number;
  pageURL: string;
  tags: string;
  user: string;
  user_id?: number;
  videos: {
    large?: PixabayVideoSize;
    medium?: PixabayVideoSize;
    small?: PixabayVideoSize;
    tiny?: PixabayVideoSize;
  };
}

const pixabayProfileUrl = (v: PixabayVideo): string => {
  if (v.user_id && v.user) {
    const slug = v.user.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `https://pixabay.com/users/${slug}-${v.user_id}/`;
  }
  return v.pageURL || 'https://pixabay.com/videos/';
};

const pickPreview = (v: PixabayVideo): PixabayVideoSize | undefined =>
  v.videos.tiny || v.videos.small || v.videos.medium;

const pickImport = (v: PixabayVideo): PixabayVideoSize | undefined =>
  v.videos.medium || v.videos.large || v.videos.small || v.videos.tiny;

interface VideoStockProps {
  onImported: (media: { id: string; path: string }) => void;
}

export const VideoStock: FC<VideoStockProps> = ({ onImported }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [query, setQuery] = useState('nature timelapse');
  const [hits, setHits] = useState<PixabayVideo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);

  // The images panel got this in D-01 and the video one did not, so B-roll
  // still opened on "No results. Type a phrase and press Search." with the
  // phrase already typed — a Search click that only exists to confirm what the
  // box already says. That is the fourth click the phase DoD does not allow.
  const autoRan = useRef(false);

  const handleSearch = useCallback(async () => {
    setIsSearching(true);
    try {
      const res = await fetch(
        `/media/pixabay-videos?q=${encodeURIComponent(query)}`
      );
      if (!res.ok) {
        toaster.show(
          t('video_stock_search_failed', 'Video search failed.'),
          'warning'
        );
        return;
      }
      // Guard an empty / non-JSON 200 body (auth redirect, proxy hiccup) —
      // res.json() on an empty body throws "Unexpected end of JSON input".
      const data = await res.json().catch(() => null);
      if (!data) {
        toaster.show(
          t('video_stock_search_failed', 'Video search failed.'),
          'warning'
        );
        return;
      }
      if (data?.note === 'PIXABAY_API_KEY not configured') {
        setNotConfigured(true);
        return;
      }
      setNotConfigured(false);
      setHits(Array.isArray(data?.hits) ? (data.hits as PixabayVideo[]) : []);
    } finally {
      setIsSearching(false);
    }
  }, [fetch, query, toaster, t]);

  const handleImport = useCallback(
    async (v: PixabayVideo) => {
      const target = pickImport(v);
      if (!target?.url) {
        toaster.show(
          t('video_stock_no_variant', 'No downloadable video version available.'),
          'warning'
        );
        return;
      }
      setImportingId(v.id);
      try {
        const res = await fetch('/media/pixabay-videos/import', {
          method: 'POST',
          body: JSON.stringify({ url: target.url, sourceId: v.id }),
        });
        if (!res.ok) {
          toaster.show(
            t('video_stock_import_failed', 'Video import failed.'),
            'warning'
          );
          return;
        }
        const data = await res.json();
        if (data?.id && data?.path) {
          onImported({ id: data.id, path: data.path });
        }
      } finally {
        setImportingId(null);
      }
    },
    [fetch, onImported, toaster, t]
  );

  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    handleSearch();
  }, [handleSearch]);

  if (notConfigured) {
    return (
      <div className="flex flex-col gap-3 p-4 text-center">
        <div className="text-sm text-textColor">
          ⚠️{' '}
          {t(
            'video_stock_no_key',
            'Stock video search is unavailable right now. Upload your own clip, or try again later.'
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-xs text-textColor/80">
        {t(
          'video_stock_explainer',
          'Stock B-roll from Pixabay — click Import to download a video into your media library. The Pixabay License allows commercial use.'
        )}{' '}
        <a
          href="https://pixabay.com/service/license-summary/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-newAccent hover:underline"
        >
          {t('video_stock_license', 'Pixabay License')} ↗
        </a>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={t('video_stock_search_ph', 'e.g. nature timelapse, city street, ocean')}
          className="flex-1 text-xs px-2 py-1 rounded bg-newColColor border border-newBorder text-textColor focus:outline-none focus:border-forth"
        />
        <Button
          loading={isSearching}
          onClick={handleSearch}
          className="!h-[28px] !text-xs"
        >
          🔍 {t('video_stock_search', 'Search')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
        {hits.length === 0 && !isSearching && (
          <div className="col-span-2 text-xs text-textColor/40 text-center py-4">
            {t('video_stock_no_results', 'No results. Type a phrase and press Search.')}
          </div>
        )}
        {hits.map((v) => {
          const preview = pickPreview(v);
          const isImporting = importingId === v.id;
          return (
            <div
              key={v.id}
              className="flex flex-col gap-1 p-2 rounded border border-newBorder bg-newColColor hover:border-newAccent/60 transition-colors"
            >
              <button
                type="button"
                onClick={() => setPreviewId(previewId === v.id ? null : v.id)}
                className="relative w-full aspect-video bg-black rounded overflow-hidden"
                title={t('video_stock_preview', 'Preview')}
              >
                {previewId === v.id && preview?.url ? (
                  <video
                    src={preview.url}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : preview?.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview.thumbnail}
                    alt={v.tags}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-textColor/50 text-[10px]">
                    {t('video_stock_no_preview', 'No preview')}
                  </div>
                )}
                <div className="absolute bottom-0 right-0 bg-black/70 text-white text-[9px] px-1 rounded-tl">
                  {Math.round(v.duration)}s
                </div>
              </button>
              <div className="text-[10px] text-textColor/70 truncate" title={v.tags}>
                {v.tags}
              </div>
              <div className="flex items-center justify-between">
                <a
                  href={pixabayProfileUrl(v)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-newAccent hover:underline truncate"
                  title={t('video_stock_attrib_author', 'Author on Pixabay')}
                >
                  📷 {v.user}
                </a>
                <Button
                  loading={isImporting}
                  onClick={() => handleImport(v)}
                  className="!h-[24px] !text-[10px] !px-2"
                >
                  {isImporting
                    ? t('video_stock_importing', 'Downloading…')
                    : t('video_stock_import', 'Import')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
