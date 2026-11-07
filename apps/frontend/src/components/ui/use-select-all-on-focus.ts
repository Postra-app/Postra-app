'use client';

import { useRef } from 'react';
import type { FocusEvent, MouseEvent } from 'react';

// For a search box that opens on a starter phrase: focusing it selects the
// phrase, so a typed word replaces it instead of being glued to its end.
// Selecting in onFocus alone is not enough in Safari: there the mouseup of the
// same click puts the caret where the pointer is and drops the selection.
// Cancelling that one mouseup keeps it; a click in a box that already has
// focus still places the caret as usual.
export function useSelectAllOnFocus() {
  const focusingClick = useRef(false);
  return {
    onMouseDown: (e: MouseEvent<HTMLInputElement>) => {
      focusingClick.current = document.activeElement !== e.currentTarget;
    },
    onFocus: (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
    onMouseUp: (e: MouseEvent<HTMLInputElement>) => {
      if (!focusingClick.current) return;
      focusingClick.current = false;
      e.preventDefault();
    },
  };
}
