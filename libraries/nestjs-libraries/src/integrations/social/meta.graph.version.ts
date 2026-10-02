// One Graph API version for every Meta call (Facebook, Instagram, Instagram
// standalone). v20.0 expired on 2026-09-24 and Meta was silently upgrading our
// calls; mixed v20/v21/v23 URLs made that impossible to reason about (U2,
// upstream 3fab214f, d2246cbc). Bump here, and check the insights metrics in
// facebook/instagram providers against Meta's changelog when you do.
export const META_GRAPH_API_VERSION = 'v25.0';
