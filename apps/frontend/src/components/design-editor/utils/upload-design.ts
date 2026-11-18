import { markAiGenerated } from './ai-provenance';
import { markCredits } from './stock-credit';

/** A design the library refused: nothing was added, the work stays. */
export class DesignUploadError extends Error {
  constructor(public status: number) {
    super(`design upload failed (${status})`);
  }
}

/**
 * One way out of Studio into the library, for every export.
 *
 * "Use in Post", the carousel export and "Add all to post" read the upload's
 * answer without checking it: with the library full (402, "No, cancel!") the
 * answer had no id, the canvas went to /media/undefined/canvas, Studio closed,
 * the draft was deleted and the post got an empty attachment. This
 * throws instead, before anything is closed or cleared.
 */
export const uploadDesign = async (
  fetch: (url: string, options?: RequestInit) => Promise<Response>,
  blob: Blob,
  name: string,
  canvasJson?: string | null
): Promise<{ id: string; path: string; credit?: string | null }> => {
  const formData = new FormData();
  formData.append('file', blob, name);
  markAiGenerated(formData, canvasJson);
  markCredits(formData, canvasJson);
  const uploaded = await fetch('/media/upload-simple', {
    method: 'POST',
    body: formData,
  });
  if (!uploaded.ok) throw new DesignUploadError(uploaded.status);
  const data = await uploaded.json();
  if (!data?.id || !data?.path) throw new DesignUploadError(0);
  if (canvasJson) {
    const saved = await fetch(`/media/${data.id}/canvas`, {
      method: 'PUT',
      body: JSON.stringify({ canvasJson }),
    });
    if (!saved.ok) throw new DesignUploadError(saved.status);
  }
  return { id: data.id, path: data.path, credit: data.credit ?? null };
};
