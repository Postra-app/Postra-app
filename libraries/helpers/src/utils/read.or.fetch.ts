import { readFileSync } from 'fs';
import { resolve } from 'path';
import axios from 'axios';
import { ownMediaHosts } from './own.media.url';

// Our own media come from the storage hosts in the environment (the CDN under
// its current and older names), not a list here: the CDN moved to
// cdn.postra.co.uk on 2026-10-27 and the older name came along.
const ALLOWED_HOSTS = new Set([
  'pbs.twimg.com',
  'video.twimg.com',
  'media.licdn.com',
  'scontent.xx.fbcdn.net',
  'platform-lookaside.fbsbx.com',
  'p16-sign-sg.tiktokcdn.com',
  'i.pinimg.com',
  'i.ytimg.com',
  'pixabay.com',
]);

export const isAllowedUrl = (
  url: string,
  env: Record<string, string | undefined> = process.env
): boolean => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return (
      ownMediaHosts(env).includes(parsed.host.toLowerCase()) ||
      ALLOWED_HOSTS.has(parsed.hostname) ||
      parsed.hostname.endsWith('.twimg.com') ||
      parsed.hostname.endsWith('.licdn.com') ||
      parsed.hostname.endsWith('.fbcdn.net') ||
      parsed.hostname.endsWith('.fbsbx.com') ||
      parsed.hostname.endsWith('.cdninstagram.com') ||
      parsed.hostname.endsWith('.tiktokcdn.com') ||
      parsed.hostname.endsWith('.pinimg.com') ||
      parsed.hostname.endsWith('.ytimg.com')
    );
  } catch {
    return false;
  }
};

export const READ_OR_FETCH_MAX_BYTES = 60 * 1024 * 1024;

// A redirect is a new request: the host it points at has to pass the same
// check, or one allowed host that redirects would let us fetch any address,
// internal ones included.
export const refuseRedirectOutsideAllowedHosts = (options: {
  href?: string;
  protocol?: string;
  hostname?: string;
  host?: string;
  port?: string | number;
  path?: string;
}) => {
  const target =
    options.href ||
    `${options.protocol}//${options.hostname || options.host}${
      options.port ? `:${options.port}` : ''
    }${options.path || '/'}`;
  if (!isAllowedUrl(target)) {
    throw new Error('readOrFetch: blocked redirect to untrusted URL');
  }
};

export const readOrFetch = async (path: string) => {
  if (path.startsWith('http')) {
    if (!isAllowedUrl(path)) {
      throw new Error(`readOrFetch: blocked request to untrusted URL`);
    }
    return (
      await axios({
        url: path,
        method: 'GET',
        responseType: 'arraybuffer',
        maxRedirects: 2,
        beforeRedirect: refuseRedirectOutsideAllowedHosts,
        timeout: 30_000,
        // A body has an end: the largest picture or thumbnail any platform
        // takes is far below this.
        maxContentLength: READ_OR_FETCH_MAX_BYTES,
      })
    ).data;
  }

  const resolved = resolve(path);
  if (!resolved.startsWith('/uploads/') && !resolved.startsWith('/app/uploads/')) {
    throw new Error(`readOrFetch: blocked read outside /uploads/`);
  }
  return readFileSync(resolved);
};
