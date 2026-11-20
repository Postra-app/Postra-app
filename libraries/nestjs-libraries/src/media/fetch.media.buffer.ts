import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

// A post's media `path` is client-controlled (MediaDto only checks the file
// extension), so any code that fetches it server-side at publish time is an
// SSRF sink into the VPC / IMDS / localhost. Every such fetch must go through
// here: DNS-pinned private-IP guard + pooled SSRF-safe dispatcher + no
// redirects + a hard timeout so a slow internal host can't pin the worker.
// Same defence the webhook/autopost/captions surfaces already use.
async function fetchMediaResponse(
  url: string,
  timeoutMs: number,
  signal: AbortSignal = AbortSignal.timeout(timeoutMs)
) {
  if (!(await isSafePublicHttpsUrl(url))) {
    throw new Error('fetchMediaBuffer: blocked request to untrusted URL');
  }

  const response = await fetch(url, {
    method: 'GET',
    // The stored bytes as they are: a CDN that compresses on the fly drops
    // Content-Length (upstream 5a9b1cc9).
    headers: { 'accept-encoding': 'identity' },
    dispatcher: ssrfSafeDispatcher,
    redirect: 'error',
    signal,
  });

  if (!response.ok) {
    throw new Error(`fetchMediaBuffer: upstream returned ${response.status}`);
  }

  return response;
}

// A body read into memory has to have an end. Importing media from a URL
// buffered whatever the server sent before looking at it, so one server
// streaming gigabytes — with or without Content-Length — filled the backend's
// memory for every user.
export const URL_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
export const MEDIA_FETCH_MAX_BYTES = 1024 * 1024 * 1024;
export async function readResponseCapped(
  response: Awaited<ReturnType<typeof fetch>>,
  maxBytes = URL_IMPORT_MAX_BYTES
): Promise<Buffer> {
  const tooLarge = () =>
    new Error(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch((): undefined => undefined);
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > maxBytes) {
      await response.body?.cancel().catch((): undefined => undefined);
      throw tooLarge();
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function fetchMediaBuffer(
  url: string,
  timeoutMs = 30_000
): Promise<Buffer> {
  const response = await fetchMediaResponse(url, timeoutMs);
  // The address comes from the post: counted while it arrives, up to the
  // largest file Postra accepts (a 1 GB video).
  return readResponseCapped(response, MEDIA_FETCH_MAX_BYTES);
}

// For sinks that need the content type as well (e.g. re-uploading the media
// to a third party as multipart/blob). Returns undici's Blob type.
export async function fetchMediaBlob(url: string, timeoutMs = 30_000) {
  const response = await fetchMediaResponse(url, timeoutMs);
  return response.blob();
}

// For large videos handed on as a stream (YouTube upload). The timeout covers
// only the wait for the response headers: a total timeout would cut a long
// download off mid-upload, and a stalled body is bounded by the dispatcher's
// bodyTimeout instead.
export async function fetchMediaStream(
  url: string,
  headersTimeoutMs = 60_000
): Promise<Readable> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), headersTimeoutMs);
  try {
    const response = await fetchMediaResponse(url, headersTimeoutMs, abort.signal);
    if (!response.body) {
      throw new Error('fetchMediaStream: empty response body');
    }
    return Readable.fromWeb(response.body as any);
  } finally {
    clearTimeout(timer);
  }
}

// For uploads that must declare their size up front (an S3 form upload, as
// Pinterest's media upload is, answers a chunked body with 411). The length
// comes from the server; a file sent without one is counted into a temporary
// file on disk (not memory), up to the largest file Postra accepts, and the
// file goes when its stream closes. The timeout covers only the headers, as
// in fetchMediaStream.
export async function fetchMediaStreamWithLength(
  url: string,
  headersTimeoutMs = 60_000
): Promise<{ stream: Readable; length: number; contentType: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), headersTimeoutMs);
  let response: Awaited<ReturnType<typeof fetchMediaResponse>>;
  try {
    response = await fetchMediaResponse(url, headersTimeoutMs, abort.signal);
  } finally {
    clearTimeout(timer);
  }
  if (!response.body) {
    throw new Error('fetchMediaStreamWithLength: empty response body');
  }
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream';
  const tooLarge = () =>
    new Error(
      `The file is larger than ${Math.round(MEDIA_FETCH_MAX_BYTES / 1024 / 1024)} MB`
    );

  const declared = Number(response.headers.get('content-length'));
  if (Number.isInteger(declared) && declared > 0) {
    if (declared > MEDIA_FETCH_MAX_BYTES) {
      await response.body.cancel().catch((): undefined => undefined);
      throw tooLarge();
    }
    return {
      stream: Readable.fromWeb(response.body as any),
      length: declared,
      contentType,
    };
  }

  const dir = await mkdtemp(join(tmpdir(), 'postra-media-'));
  const remove = () =>
    rm(dir, { recursive: true, force: true }).catch((): undefined => undefined);
  try {
    const file = join(dir, 'media');
    let length = 0;
    await pipeline(
      Readable.fromWeb(response.body as any),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          length += chunk.length;
          done(length > MEDIA_FETCH_MAX_BYTES ? tooLarge() : null, chunk);
        },
      }),
      createWriteStream(file)
    );
    const stream = createReadStream(file);
    stream.once('close', remove);
    return { stream, length, contentType };
  } catch (err) {
    await remove();
    throw err;
  }
}
