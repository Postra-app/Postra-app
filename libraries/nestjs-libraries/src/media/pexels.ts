/**
 * Pexels — the second free stock library next to Pixabay (K. 2026-10-08).
 * Free API (200 requests an hour, 20 000 a month); its guidelines ask for a
 * visible link to Pexels and, where possible, the photographer's credit, so
 * every hit carries both. Files are imported into the media library, never
 * hotlinked. PEXELS_API_URL and PEXELS_ASSET_ORIGIN point the stack tests at
 * a fake; production uses Pexels' own hosts only.
 */
export const pexelsApiUrl = (path: string) =>
  `${(process.env.PEXELS_API_URL || 'https://api.pexels.com').replace(/\/+$/, '')}${path}`;

export interface PexelsHit {
  id: number;
  previewURL: string;
  importURL: string;
  pageURL: string;
  user: string;
  userURL: string;
  alt?: string;
  duration?: number;
}

export const pexelsPhotoHits = (data: any): PexelsHit[] =>
  (data?.photos || [])
    .filter((p: any) => p?.src?.medium && (p.src.large2x || p.src.original))
    .map((p: any) => ({
      id: p.id,
      previewURL: p.src.medium,
      importURL: p.src.large2x || p.src.original,
      pageURL: p.url,
      user: p.photographer,
      userURL: p.photographer_url,
      alt: p.alt || '',
    }));

// The largest MP4 that is at most 1920 wide: social video does not need 4K,
// and the import is buffered in memory.
const bestFile = (files: any[] = []) =>
  files
    .filter((f) => f?.file_type === 'video/mp4' && f.link && (f.width || 0) <= 1920)
    .sort((a, b) => (b.width || 0) - (a.width || 0))[0];

const smallestFile = (files: any[] = []) =>
  files
    .filter((f) => f?.file_type === 'video/mp4' && f.link)
    .sort((a, b) => (a.width || 0) - (b.width || 0))[0];

export const pexelsVideoHits = (data: any): PexelsHit[] =>
  (data?.videos || [])
    .map((v: any) => ({ v, best: bestFile(v.video_files), small: smallestFile(v.video_files) }))
    .filter(({ best, small }: any) => best && small)
    .map(({ v, best, small }: any) => ({
      id: v.id,
      previewURL: small.link,
      importURL: best.link,
      thumbnail: v.image,
      pageURL: v.url,
      user: v.user?.name || '',
      userURL: v.user?.url || '',
      duration: v.duration,
    }));

const PEXELS_HOSTS = new Set(['images.pexels.com', 'videos.pexels.com']);

/** Only Pexels' file hosts (https) — the import fetches whatever URL it gets. */
export const isPexelsAssetUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const origin = process.env.PEXELS_ASSET_ORIGIN;
  if (origin && value.startsWith(origin)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && PEXELS_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};
