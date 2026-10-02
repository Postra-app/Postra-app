import { useEffect, useState } from 'react';

/**
 * Mobile breakpoint = below `md` (768px), matching the app shell (the
 * sidebar disappears and the bottom nav appears at `md`).
 *
 * SSR-safe: returns `false` on the server and on the first client render
 * (matching SSR), then corrects itself from `matchMedia` after mount — no
 * hydration mismatch. Only for progressively switching on mobile behaviour;
 * the desktop view (>=768px) stays untouched.
 */
export function useIsMobile(maxWidth = 767): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [maxWidth]);

  return isMobile;
}
