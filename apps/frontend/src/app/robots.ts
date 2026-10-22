import type { MetadataRoute } from 'next';

// The app host is the product behind a login, not a site to index: nothing
// here belongs in search results (the login page was indexable and
// /robots.txt was the 404 page until 2026-10-22, E2E-11-45). The public
// landing at postra.co.uk has its own robots.txt and sitemap. The path is
// outside proxy.ts: its matcher skips `<name>.<ext>` paths.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
