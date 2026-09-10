'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@gitroom/frontend/components/ui/button';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import {
  UploadedMedia,
  useUploadResult,
} from '@gitroom/frontend/components/video-studio/use-upload-result';
import {
  RenderResult,
  planUpload,
} from '@gitroom/frontend/components/video-studio/result-plan';

interface ResultPanelProps {
  results: RenderResult[];
  /** File name for a result, without the extension. */
  fileNameFor: (result: RenderResult) => string;
  /** Called with the media the user wants in the post. */
  onUseInPost: (media: UploadedMedia) => void;
  /** Called after a "save only", with everything that was stored. */
  onSaved?: (media: UploadedMedia[]) => void;
}

/**
 * The end of every render, in one place.
 *
 * Each tab used to finish differently: two had a preview and three buttons
 * (copied line for line), Captions uploaded and closed the modal without ever
 * showing the result, Formats attached every size to the post at once. Same
 * three exits everywhere now: use it in the post, keep it in the library,
 * download it.
 */
export const ResultPanel: FC<ResultPanelProps> = ({
  results,
  fileNameFor,
  onUseInPost,
  onSaved,
}) => {
  const t = useT();
  const toaster = useToaster();
  const { uploading, upload } = useUploadResult();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = useMemo(
    () => results.find((r) => r.key === selectedKey) ?? results[0],
    [results, selectedKey]
  );

  // Object URLs are created for the whole set and revoked together, so
  // switching between formats does not leak one per click.
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results) map.set(r.key, URL.createObjectURL(r.blob));
    return map;
  }, [results]);

  useEffect(() => {
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [urls]);

  const run = useCallback(
    async (intent: 'post' | 'library') => {
      const plan = planUpload(results, selected?.key ?? null, intent);
      const stored: UploadedMedia[] = [];
      for (const key of plan.toUpload) {
        const result = results.find((r) => r.key === key);
        if (!result) continue;
        const media = await upload(result.blob, `${fileNameFor(result)}.mp4`);
        // One failed upload (size ceiling, network) already told the user;
        // stop rather than half-attach a set.
        if (!media) return;
        stored.push(media);
        if (key === plan.toAttach) onUseInPost(media);
      }
      if (intent === 'library') {
        toaster.show(
          stored.length > 1
            ? t(
                'video_saved_to_library_many',
                'Saved {n} files to your media library.'
              ).replace('{n}', String(stored.length))
            : t(
                'video_saved_to_library',
                'Saved to media library — you can use it in any post.'
              ),
          'success'
        );
        onSaved?.(stored);
      }
    },
    [results, selected, upload, fileNameFor, onUseInPost, onSaved, toaster, t]
  );

  if (!results.length || !selected) return null;

  const previewUrl = urls.get(selected.key);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-green-400">
        <StudioIcon name="done" size={13} className="inline-block shrink-0" />{' '}
        {selected.hadAudio === null || selected.hadAudio === undefined
          ? t('video_result_ready', 'ready')
          : selected.hadAudio
          ? t('compositor_with_audio', 'with audio')
          : t('compositor_no_audio', 'no audio')}
      </div>

      {results.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {results.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setSelectedKey(r.key)}
              className={
                r.key === selected.key
                  ? 'text-[11px] px-2 h-[26px] rounded bg-forth text-white'
                  : 'text-[11px] px-2 h-[26px] rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors'
              }
            >
              {r.label}
            </button>
          ))}
          <span className="text-[11px] text-textColor/60 ml-1">
            {t(
              'video_result_all_saved',
              'All are kept; the one you pick goes into the post.'
            )}
          </span>
        </div>
      )}

      {previewUrl && (
        // A 9:16 clip at full width pushed the three exits below the fold, so
        // the preview is capped by height and centred instead.
        <video
          key={selected.key}
          src={previewUrl}
          controls
          className="w-auto max-w-full max-h-[220px] mx-auto rounded border border-newBorder bg-black"
        />
      )}

      <div className="flex items-center gap-2">
        <Button
          loading={uploading}
          onClick={() => run('post')}
          className="!h-[30px] !text-xs"
        >
          {t('clip_text_use_in_post', 'Use in post')}
        </Button>
        <button
          type="button"
          onClick={() => run('library')}
          disabled={uploading}
          className="text-xs px-3 h-[30px] rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors disabled:opacity-50"
        >
          {t('save_to_library_btn', 'Save to library')}
        </button>
        {previewUrl && (
          <a
            href={previewUrl}
            download={`${fileNameFor(selected)}.mp4`}
            className="text-[11px] text-newAccent underline"
          >
            {t('clip_text_download', 'Download')}
          </a>
        )}
      </div>
    </div>
  );
};
