import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

// Large videos are uploaded to a platform part by part, and each part is read
// from our media storage right before it is sent: the worker never holds the
// whole file (a 1 GB video used to sit in memory per post, on a box whose
// orchestrator already takes ~1.4 GB). Same SSRF guard as fetch.media.buffer:
// the path comes from the post.
//
// `accept-encoding: identity` on every read: a compressed answer has no
// Content-Length, and a CDN answers a range request on such an object with the
// whole body and a 200 (upstream 5a9b1cc9).

export class MediaRangeUnsupported extends Error {}

const isRemote = (path: string) => path.startsWith('http');

// Local storage (self-hosted installs): only files under the upload directory.
const localFile = (path: string) => {
  const resolved = resolve(path);
  if (!resolved.startsWith('/uploads/') && !resolved.startsWith('/app/uploads/')) {
    throw new Error('mediaRange: blocked read outside /uploads/');
  }
  return resolved;
};

const guard = async (url: string) => {
  if (!(await isSafePublicHttpsUrl(url))) {
    throw new Error('mediaRange: blocked request to untrusted URL');
  }
};

/** Size of the media in bytes, without downloading it. */
export async function mediaSize(path: string, timeoutMs = 30_000): Promise<number> {
  if (!isRemote(path)) {
    return statSync(localFile(path)).size;
  }
  await guard(path);
  const response = await fetch(path, {
    method: 'HEAD',
    headers: { 'accept-encoding': 'identity' },
    dispatcher: ssrfSafeDispatcher,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`mediaSize: media storage returned ${response.status}`);
  }
  const length = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Error('mediaSize: media storage did not report the file size');
  }
  return length;
}

/** Bytes `start`..`end` (inclusive) of the media. */
export async function mediaRange(
  path: string,
  start: number,
  end: number,
  timeoutMs = 60_000
): Promise<Buffer> {
  const expected = end - start + 1;
  let part: Buffer;

  if (!isRemote(path)) {
    part = await new Promise<Buffer>((done, fail) => {
      const chunks: Buffer[] = [];
      createReadStream(localFile(path), { start, end })
        .on('data', (chunk) => chunks.push(chunk as Buffer))
        .on('end', () => done(Buffer.concat(chunks)))
        .on('error', fail);
    });
  } else {
    await guard(path);
    const response = await fetch(path, {
      headers: { range: `bytes=${start}-${end}`, 'accept-encoding': 'identity' },
      dispatcher: ssrfSafeDispatcher,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // A 200 is the whole file: sent as one part it would corrupt the video
    // without an error anywhere.
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      throw new MediaRangeUnsupported(
        `Media storage ignored the range request (status ${response.status}); large videos need HTTP Range support`
      );
    }
    part = Buffer.from(await response.arrayBuffer());
  }

  // A short part (a connection cut mid-body) would shift every byte after it.
  if (part.length !== expected) {
    throw new Error(`mediaRange: got ${part.length} bytes of ${expected}`);
  }
  return part;
}
