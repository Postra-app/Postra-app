/**
 * Unsplash — free photos next to Pixabay (Pexels stopped issuing
 * keys). API terms (unsplash.com/documentation): authenticate with
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

/**
 * The credit Unsplash asks for in the text of a social post that uses one of
 * its photos: the photographer, their social handle when they have one, and
 * Unsplash. From GET /photos/:id (the photographer as Unsplash has them, not
 * as the browser sent them). Empty when there is no name.
 */
/**
 * Credit lines a client may attach to its own upload (a Studio design with
 * Unsplash photos): only lines in that form, at most ten, so the field cannot
 * carry arbitrary text into posts. Empty when none qualify.
 */
export const creditLinesFromClient = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const lines = value
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => /^Photo by [^<>\n]{1,120} on Unsplash$/.test(l));
  return [...new Set(lines)].slice(0, 10).join('\n');
};

export const unsplashCredit = (photo: any): string => {
  const name = String(photo?.user?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) return '';
  const handle = String(photo?.user?.instagram_username || photo?.user?.twitter_username || '')
    .replace(/^@/, '')
    .trim();
  const tag = /^[A-Za-z0-9._]{1,30}$/.test(handle) ? ` (@${handle})` : '';
  return `Photo by ${name}${tag} on Unsplash`;
};
