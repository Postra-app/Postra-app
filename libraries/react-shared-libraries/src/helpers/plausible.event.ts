// Plausible custom events for the app (no cookies, privacy policy §13).
// Props are categories only, never names, e-mail addresses or post text:
// a toast can carry a channel's name, so the toast's text is never sent.
// The script loads only when PLAUSIBLE_SCRIPT_ID is set (app layout.tsx);
// without it this does nothing.

type Props = Record<string, string | number | boolean>;

// "/p/cmh2x9k1z0001abcd/edit" -> "/p/:id/edit": ids say nothing about where
// people struggle and would split one page into thousands of rows.
export const routeTemplate = (path: string) =>
  path
    .split('/')
    // cuid and uuid always carry digits; slugs like instagram-standalone don't.
    .map((seg) => (/\d/.test(seg) && seg.length >= 8 ? ':id' : seg))
    .join('/') || '/';

export const plausibleEvent = (name: string, props?: Props) => {
  if (typeof window === 'undefined') return;
  const plausible = (window as any).plausible;
  if (typeof plausible !== 'function') return;
  try {
    plausible(name, props ? { props } : undefined);
  } catch {
    // Analytics must never break the page.
  }
};
