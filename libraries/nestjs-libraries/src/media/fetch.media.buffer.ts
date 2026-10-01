import { fetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

// A post's media `path` is client-controlled (MediaDto only checks the file
// extension), so any code that fetches it server-side at publish time is an
// SSRF sink into the VPC / IMDS / localhost. Every such fetch must go through
// here: DNS-pinned private-IP guard + pooled SSRF-safe dispatcher + no
// redirects + a hard timeout so a slow internal host can't pin the worker.
// Same defence the webhook/autopost/captions surfaces already use.
async function fetchMediaResponse(url: string, timeoutMs: number) {
  if (!(await isSafePublicHttpsUrl(url))) {
    throw new Error('fetchMediaBuffer: blocked request to untrusted URL');
  }

  const response = await fetch(url, {
    method: 'GET',
    dispatcher: ssrfSafeDispatcher,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`fetchMediaBuffer: upstream returned ${response.status}`);
  }

  return response;
}

export async function fetchMediaBuffer(
  url: string,
  timeoutMs = 30_000
): Promise<Buffer> {
  const response = await fetchMediaResponse(url, timeoutMs);
  return Buffer.from(await response.arrayBuffer());
}

// For sinks that need the content type as well (e.g. re-uploading the media
// to a third party as multipart/blob). Returns undici's Blob type.
export async function fetchMediaBlob(url: string, timeoutMs = 30_000) {
  const response = await fetchMediaResponse(url, timeoutMs);
  return response.blob();
}
