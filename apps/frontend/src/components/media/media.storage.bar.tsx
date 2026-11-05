'use client';

import React, { FC, useEffect } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const GB = 1024 * 1024 * 1024;

// 1.2 GB, 850 MB: the same wording as the server's "library is full".
export const formatBytes = (bytes: number): string => {
  if (bytes >= GB) return `${+(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

/**
 * How much of the plan's media storage the library uses: the customer
 * must see the limit before it stops an upload.
 * Nothing while billing is off: there is no limit then. `version` changes
 * whenever the library does, so the bar follows uploads and deletes.
 */
export const MediaStorageBar: FC<{ version?: unknown }> = ({ version }) => {
  const fetch = useFetch();
  const t = useT();
  const { data, mutate } = useSWR<{ used: number; limit: number | null }>(
    'media-storage',
    async () => (await fetch('/media/storage')).json()
  );
  useEffect(() => {
    mutate();
  }, [version, mutate]);

  if (!data || !data.limit) {
    return null;
  }
  const share = Math.min(1, data.used / data.limit);
  const full = data.used >= data.limit;
  const nearly = !full && share >= 0.8;
  return (
    <div className="flex flex-col gap-[6px]" data-testid="media-storage">
      <div className="flex items-center justify-between gap-[12px] text-[13px]">
        <span className="text-textColor/80">
          {t('media_storage_used', '{{used}} of {{limit}} used', {
            used: formatBytes(data.used),
            limit: formatBytes(data.limit),
          })}
        </span>
        {full ? (
          <a href="/billing" className="text-[#f87171] underline" data-testid="media-storage-full">
            {t(
              'media_storage_full',
              'Your media library is full. Delete files you no longer need, or upgrade your plan.'
            )}
          </a>
        ) : nearly ? (
          <a href="/billing" className="text-[#fbbf24] underline" data-testid="media-storage-nearly">
            {t('media_storage_nearly', 'Almost full. Upgrade your plan for more space.')}
          </a>
        ) : null}
      </div>
      <div
        className="h-[6px] w-full rounded-full bg-white/[0.06] overflow-hidden"
        role="progressbar"
        aria-label={t('media_storage_label', 'Media storage')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div
          className={clsx(
            'h-full rounded-full',
            full ? 'bg-[#f87171]' : nearly ? 'bg-[#fbbf24]' : 'bg-[#38bdf8]'
          )}
          style={{ width: `${Math.max(share * 100, data.used > 0 ? 1 : 0)}%` }}
        />
      </div>
    </div>
  );
};
