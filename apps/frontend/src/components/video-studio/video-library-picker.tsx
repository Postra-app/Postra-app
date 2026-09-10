'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';
import { isVideoMedia } from '@gitroom/helpers/utils/media.type';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export interface LibraryMedia {
  id: string;
  path: string;
}

interface VideoLibraryPickerProps {
  onPick: (media: LibraryMedia) => void;
  onClose: () => void;
  busy?: boolean;
}

/**
 * Phase 1 of Postra Clip — pick an existing video from the media library
 * (a previous upload or an imported Pixabay B-roll) and load it into the editor.
 * Closes the get → edit → schedule loop: imported stock is no longer a dead end.
 *
 * Mirrors media.component.tsx: GET /media?page=&search= returns { results, pages },
 * a clip is a result whose path contains "mp4".
 */
export const VideoLibraryPicker: FC<VideoLibraryPickerProps> = ({
  onPick,
  onClose,
  busy,
}) => {
  const t = useT();
  const fetch = useFetch();
  const mediaDirectory = useMediaDirectory();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);

  // Reset to the first page whenever the query changes (same as media library).
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  const loadMedia = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page + 1), type: 'video' });
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    return (await fetch(`/media?${params.toString()}`)).json();
  }, [fetch, page, debouncedSearch]);

  const { data, isLoading } = useSWR(
    `video-picker-${page}-${debouncedSearch}`,
    loadMedia
  );

  // The server already returns videos only, so a page is never empty just
  // because the first 18 rows of the library happened to be images.
  const videos: LibraryMedia[] = (data?.results ?? []).filter((f: any) =>
    isVideoMedia(f)
  );
  const pages: number = data?.pages ?? 0;

  return (
    <div className="flex flex-col h-full bg-[rgba(10,14,26,0.97)] backdrop-blur-xl">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-newBorder">
        <span className="text-sm text-textColor">
          {t('video_library_title', 'Library videos')}
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('video_library_search', 'Search…')}
          disabled={busy}
          className="flex-1 text-xs px-2 py-1 rounded bg-newColColor border border-newBorder text-textColor placeholder-textColor/40 focus:outline-none focus:border-forth disabled:opacity-50"
        />
        <button
          onClick={onClose}
          disabled={busy}
          className="text-xs px-3 py-1 rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors disabled:opacity-50"
        >
          {t('close', 'Close')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2">
            {[...new Array(6)].map((_, i) => (
              <div
                key={i}
                className="aspect-video rounded bg-newColColor animate-pulse"
              />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
            <div className="text-sm text-textColor/70">
              {t(
                'video_library_empty',
                'No videos in your library. Upload a clip from disk or import free B-roll from the "Stock B-roll" tab.'
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {videos.map((media) => (
              <button
                key={media.id}
                type="button"
                disabled={busy}
                onClick={() => onPick({ id: media.id, path: media.path })}
                className="group relative aspect-video rounded overflow-hidden border border-newBorder hover:border-newAccent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('video_library_edit', 'Edit this clip')}
              >
                <VideoFrame url={mediaDirectory.set(media.path)} />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  <StudioIcon name="edit" size={12} className="inline-block me-1" />{t('video_library_edit_cta', 'Edit')}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 border-t border-newBorder">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={busy || page === 0}
            className="text-xs px-3 py-1 rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors disabled:opacity-40"
          >
            ‹ {t('previous', 'Previous')}
          </button>
          <span className="text-[11px] text-textColor/60">
            {page + 1} / {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={busy || page >= pages - 1}
            className="text-xs px-3 py-1 rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors disabled:opacity-40"
          >
            {t('next', 'Next')} ›
          </button>
        </div>
      )}

      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-white">
          {t('video_library_loading', 'Loading clip…')}
        </div>
      )}
    </div>
  );
};
