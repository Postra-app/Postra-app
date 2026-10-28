import type { MetadataRoute } from 'next';

// The app host is the product behind a login, not a site to index: nothing
// here belongs in search results (the login page was indexable and
// /robots.txt was the 404 page until 2026-10-22). The public
// landing at postra.co.uk has its own robots.txt and sitemap. The path is
// outside proxy.ts: its matcher skips `<name>.<ext>` paths.
//
// The sign-in screens stay crawlable on purpose: Google had already indexed
// /auth as a duplicate of /auth/login ("Duplicate without user-selected
// canonical" in Search Console), and a page blocked by robots.txt never
// shows Googlebot its noindex (Google, "Block Search indexing with noindex").
// They carry noindex in app/(app)/auth/layout.tsx, so Google reads it on the
// next crawl and drops them.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/', allow: ['/auth', '/auth/'] },
  };
}
