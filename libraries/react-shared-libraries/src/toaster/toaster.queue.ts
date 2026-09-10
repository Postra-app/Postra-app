/**
 * One toast at a time was a real limit, not a style choice: Studio can report
 * "background removed", "saved to library" and "out of AI credits" within a
 * couple of seconds, and each message replaced the one before it — including
 * the one that mattered.
 */

export interface ToastItem {
  id: number;
  text: string;
  type: 'success' | 'warning';
}

/** Three is enough to keep a burst readable without covering the canvas. */
export const MAX_TOASTS = 3;

export const addToast = (
  list: ToastItem[],
  toast: ToastItem,
  max = MAX_TOASTS
): ToastItem[] => {
  // A repeat of the message already on screen renews it instead of stacking a
  // duplicate — retries in a loop should not fill the screen.
  const withoutDuplicate = list.filter((t) => t.text !== toast.text);
  return [...withoutDuplicate, toast].slice(-max);
};

export const removeToast = (list: ToastItem[], id: number): ToastItem[] =>
  list.filter((t) => t.id !== id);
