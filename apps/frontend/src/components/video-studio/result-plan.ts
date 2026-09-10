/**
 * What "Use in post" means when a render produced more than one file.
 *
 * Formats writes a file per platform size and used to attach all of them to the
 * post. Most channels take exactly one video, so the honest reading is: keep
 * every file (the user asked for them), attach the one they picked.
 */
export interface RenderResult<T = unknown> {
  /** Stable key — the format name, or a single fixed id for one-off renders. */
  key: string;
  /** Shown on the picker when there is more than one. */
  label: string;
  blob: Blob;
  /** Whether the source audio survived; null when the render never has any. */
  hadAudio?: boolean | null;
  meta?: T;
}

export interface UploadPlan {
  /** Everything worth keeping, in order. */
  toUpload: string[];
  /** The one that goes into the post, or null when only saving. */
  toAttach: string | null;
}

export function planUpload(
  results: { key: string }[],
  selectedKey: string | null,
  intent: 'post' | 'library'
): UploadPlan {
  const keys = results.map((r) => r.key);
  if (!keys.length) return { toUpload: [], toAttach: null };
  if (intent === 'library') return { toUpload: keys, toAttach: null };
  // An unknown or missing selection means the first result, so the button can
  // never do nothing.
  const chosen = selectedKey && keys.includes(selectedKey) ? selectedKey : keys[0];
  return { toUpload: keys, toAttach: chosen };
}
