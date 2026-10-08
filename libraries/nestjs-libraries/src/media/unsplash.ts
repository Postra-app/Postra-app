/**
 * Unsplash — free photos next to Pixabay (K. 2026-10-08; Pexels stopped
 * issuing keys). API terms (unsplash.com/documentation): authenticate with
 * "Client-ID <access key>", credit the photographer and Unsplash with a
 * referral back, and report each download to the photo's download_location.
 * Previews in the Studio load from Unsplash's own URLs; the picked photo is
 * copied to the media library because a post has to carry the file.
 * UNSPLASH_API_URL / UNSPLASH_ASSET_ORIGIN point the stack tests at a fake.
 */
const UTM = 'utm_source=postra&utm_medium=referral';

export const unsplashApiUrl = (path: string) =>
  `${(process.env.UNSPLASH_API_URL || 'https://api.unsplash.com').replace(/\/+$/, '')}${path}`;

export const withReferral = (url?: string) =>
  url ? `${url}${url.includes('?') ? '&' : '?'}${UTM}` : '';

export interface UnsplashHit {
  id: string;
  previewURL: string;
  importURL: string;
  pageURL: string;
  user: string;
  userURL: string;
  alt: string;
  downloadLocation: string;
}

export const unsplashPhotoHits = (data: any): UnsplashHit[] =>
  (data?.results || [])
    .filter((p: any) => p?.id && p?.urls?.small && p?.urls?.regular)
    .map((p: any) => ({
      id: String(p.id),
      previewURL: p.urls.small,
      importURL: p.urls.regular,
      pageURL: withReferral(p.links?.html),
      user: p.user?.name || '',
      userURL: withReferral(p.user?.links?.html),
      alt: p.alt_description || '',
      downloadLocation:
        p.links?.download_location || unsplashApiUrl(`/photos/${encodeURIComponent(p.id)}/download`),
    }));

const httpsOn = (value: unknown, hosts: string[], devOrigin?: string) => {
  if (typeof value !== 'string') return false;
  if (devOrigin && value.startsWith(devOrigin)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** The photo file: only Unsplash's image CDN. */
export const isUnsplashAssetUrl = (value: unknown): value is string =>
  httpsOn(value, ['images.unsplash.com', 'plus.unsplash.com'], process.env.UNSPLASH_ASSET_ORIGIN);

/** The download report: only Unsplash's API, the photos/:id/download path. */
export const isUnsplashDownloadLocation = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const devApi = process.env.UNSPLASH_API_URL;
  const ok = httpsOn(value, ['api.unsplash.com'], devApi ? `${devApi.replace(/\/+$/, '')}/photos/` : undefined);
  if (!ok) return false;
  return /\/photos\/[^/?]+\/download(\?|$)/.test(value);
};
