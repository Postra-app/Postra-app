'use client';

import { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export interface UploadedMedia {
  id: string;
  path: string;
}

/**
 * Put a rendered clip in the media library.
 *
 * Text and Photos-to-video each carried their own copy of this, character for
 * character, and the other tabs each did something slightly different with the
 * result. One copy, one error message, one in-flight guard.
 */
export function useUploadResult() {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (blob: Blob, fileName: string): Promise<UploadedMedia | null> => {
      if (uploading) return null;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', blob, fileName);
        const res = await fetch('/media/upload-simple', {
          method: 'POST',
          body: formData,
        });
        // A 413 from nginx answers with HTML, so res.json() is where an upload
        // over the size ceiling actually fails.
        const data = await res.json();
        if (data?.id && data?.path) return { id: data.id, path: data.path };
        throw new Error('upload returned no media');
      } catch {
        toaster.show(t('clip_text_upload_failed', 'Clip upload failed.'), 'warning');
        return null;
      } finally {
        setUploading(false);
      }
    },
    [uploading, fetch, toaster, t]
  );

  return { uploading, upload };
}
