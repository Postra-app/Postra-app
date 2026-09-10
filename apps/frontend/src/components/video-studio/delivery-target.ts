/**
 * Where a finished render should land.
 *
 * Opened from the composer, the studio hands the file to the post and closes.
 * That is right when the user is watching the tab that produced it, and wrong
 * when a render finished in the background while they moved on to another tab —
 * the modal used to vanish mid-edit. The file is in the library either way, so
 * the honest fallback is the "use it now or keep working" bar.
 */
export type DeliveryTarget = 'post' | 'bar';

export function deliveryTarget(
  mode: 'studio' | 'composer',
  currentTab: string,
  startedOn?: string
): DeliveryTarget {
  if (mode === 'studio') return 'bar';
  // No origin means the user asked for it right now (the "Use in post" button).
  if (startedOn !== undefined && startedOn !== currentTab) return 'bar';
  return 'post';
}
