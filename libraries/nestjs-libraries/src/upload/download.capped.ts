// undici's fetch, not Node's global one: the `dispatcher` option only works
// with an Agent from the same undici instance.
import { fetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { readResponseCapped } from '@gitroom/nestjs-libraries/media/fetch.media.buffer';

// A file copied into storage from someone else's address: a channel's
// picture, the image of an article in a feed, what an AI provider made. The
// address is checked for where it points, but the body was read whole and
// for as long as it kept coming, so one server that never stops sending
// filled the memory of the process for everyone, again at every run of a
// feed. It has an end now, in bytes and in time.
export const STORAGE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export async function downloadForStorage(
  url: string,
  timeoutMs = STORAGE_DOWNLOAD_TIMEOUT_MS,
  maxBytes?: number
): Promise<Buffer> {
  const response = await fetch(url, {
    dispatcher: ssrfSafeDispatcher,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return readResponseCapped(response, maxBytes);
}
