// A design sent from Studio with "Use in Post" arrives on the calendar as
// ?newPostMedia=[{id,path},…]. Without a connected channel there is no post
// editor to open, and the design used to vanish from sight: an empty
// calendar was the whole answer. It is kept here until a channel exists
// (connecting one can reload the page and drop the query string), and the
// calendar says so meanwhile.
const KEY = 'postra:pending-post-media';

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage can be blocked (private mode, site data off).
    return null;
  }
};

// Kept per organisation: the tab can sign out and into another account, and
// that account must not get the first one's design.
export const stashPendingPostMedia = (orgId: string | undefined, raw: string) => {
  if (!orgId) return;
  try {
    storage()?.setItem(KEY, JSON.stringify({ orgId, raw }));
  } catch {
    // The query string still carries it for this page.
  }
};

export const pendingPostMedia = (orgId: string | undefined): string | null => {
  if (!orgId) return null;
  try {
    const kept = JSON.parse(storage()?.getItem(KEY) || 'null');
    return kept?.orgId === orgId && typeof kept.raw === 'string'
      ? kept.raw
      : null;
  } catch {
    return null;
  }
};

export const clearPendingPostMedia = () => {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing was stored.
  }
};
