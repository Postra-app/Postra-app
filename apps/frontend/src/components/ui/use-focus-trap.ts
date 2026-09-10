'use client';

import { RefObject, useEffect } from 'react';

/**
 * Keep Tab inside an open dialog.
 *
 * Studio's modals set `role="dialog"`, `aria-modal` and an initial focus, but
 * Tab still walked out of them into the page behind — so a keyboard user could
 * be typing into a control they cannot see, under an overlay they cannot leave.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Where Tab goes next, wrapping at both ends. Exported for the spec — the
 *  wrap is the whole behaviour and it is pure arithmetic. */
export const nextFocusIndex = (
  current: number,
  count: number,
  backwards: boolean
): number => {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
};

export const useFocusTrap = (
  ref: RefObject<HTMLElement | null>,
  active = true
): void => {
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        // A control inside a collapsed section is in the DOM but cannot be
        // reached with the mouse either; offsetParent is the cheap test.
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(current, items.length, e.shiftKey);
      // Only take over at the ends; inside the list the browser does it right.
      const atEnd = e.shiftKey ? current <= 0 : current === items.length - 1;
      if (!atEnd && current !== -1) return;
      e.preventDefault();
      items[next]?.focus();
    };

    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [ref, active]);
};
