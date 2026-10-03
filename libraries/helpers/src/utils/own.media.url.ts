// Media in a post, and the /public/stream proxy, must come from our own
// storage: every upload, stock import (Pixabay forbids hotlinking), AutoPost
// image and AI image is stored there first. On production all 85 media of the
// last 120 days were on the CDN (E2E-02-22, measured 2026-10-03).
//
// Hosts: the upload CDN (NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY), the app itself
// (FRONTEND_URL, local storage) and any listed in RESTRICT_UPLOAD_DOMAINS
// (comma-separated). With none configured — a self-hosted install — anything
// passes, as before.
const hostOf = (value?: string) => {
  if (!value) return undefined;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return undefined;
  }
};

export const ownMediaHosts = (env: Record<string, string | undefined> = process.env) =>
  [
    hostOf(env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY),
    hostOf(env.FRONTEND_URL),
    ...(env.RESTRICT_UPLOAD_DOMAINS || '').split(',').map((d) => hostOf(d.trim())),
  ].filter((h): h is string => !!h);

export const isOwnMediaUrl = (url: string, env: Record<string, string | undefined> = process.env) => {
  const hosts = ownMediaHosts(env);
  if (!hosts.length) return true;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) && hosts.includes(parsed.host.toLowerCase());
  } catch {
    return false;
  }
};
