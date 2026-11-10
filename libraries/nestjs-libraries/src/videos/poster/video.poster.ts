import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve, sep } from 'path';
import { fetch } from 'undici';
import { readFile, unlink } from 'fs/promises';
import pLimit from 'p-limit';
import { isOwnMediaUrl } from '@gitroom/helpers/utils/own.media.url';
import type { IUploadProvider } from '@gitroom/nestjs-libraries/upload/upload.interface';

// A still frame for every video in the library. The phone app cannot pull a
// frame out of a video in a list, so every video there was a bare ▶ tile;
// `thumbnail` cannot be filled automatically because it goes to the
// platforms as the cover the customer chose. `poster` is ours alone.
//
// ffmpeg seeks over HTTP with range requests, so a 4 GB upload costs a few
// requests, not a download. One at a time per process, with a short leash.
const posterLimit = pLimit(1);
const POSTER_TIMEOUT_MS = 60_000;
// Same moment the web grid shows (#t=1), or the first frame of a shorter clip.
export const POSTER_SEEKS = ['1', '0'] as const;
// Marks a video ffmpeg could not read, so the daily run does not retry it
// for ever and starve the ones after it. Clients read `thumbnail || poster`.
export const NO_POSTER = '';

export const posterArgs = (url: string, seek: string, out: string) => [
  '-y',
  '-protocol_whitelist',
  'file,http,https,tcp,tls',
  '-ss',
  seek,
  '-i',
  url,
  '-frames:v',
  '1',
  '-vf',
  "scale='min(720,iw)':-2",
  '-q:v',
  '4',
  out,
];

const runFfmpeg = (args: string[]) =>
  posterLimit(
    () =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: 'pipe' });
        let stderr = '';
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error('ffmpeg poster timed out'));
        }, POSTER_TIMEOUT_MS);
        proc.stderr.on('data', (c) => {
          stderr = (stderr + c.toString()).slice(-2000);
        });
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`));
        });
      })
  );

/** One JPEG frame of the video at `url`, or null when there is none to take. */
export const extractPosterFrame = async (
  url: string,
  run: (args: string[]) => Promise<void> = runFfmpeg
): Promise<Buffer | null> => {
  const out = join(tmpdir(), `poster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  try {
    for (const seek of POSTER_SEEKS) {
      try {
        await run(posterArgs(url, seek, out));
        const buf = await readFile(out).catch((): null => null);
        // Seeking past the end exits 0 and writes nothing.
        if (buf?.length) return buf;
      } catch {
        // Try the next seek; a file ffmpeg cannot read fails both.
      }
    }
    return null;
  } finally {
    await unlink(out).catch(() => {});
  }
};

// Local storage serves uploads through the app's own URL, which the API
// process may not be able to reach (no proxy in front of it); read the file
// from the upload directory instead, and never outside it.
export const localSource = (
  path: string,
  env: Record<string, string | undefined> = process.env
): string | null => {
  if (env.STORAGE_PROVIDER !== 'local' || !env.UPLOAD_DIRECTORY || !env.FRONTEND_URL) {
    return null;
  }
  const prefix = `${env.FRONTEND_URL}/uploads/`;
  if (!path.startsWith(prefix)) return null;
  const root = resolve(env.UPLOAD_DIRECTORY);
  const file = resolve(root, decodeURIComponent(path.slice(prefix.length)));
  return file.startsWith(root + sep) ? file : null;
};

// Whether the stored file answers at all: a frame that could not be taken
// from a file that is there means the file has none; a file that does not
// answer is a passing failure and is tried again later.
const reachable = async (url: string) => {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * The stored poster for a video path: its public URL, NO_POSTER when the
 * file is there and has no frame, or null when there is nothing to write now
 * (not our storage — a media row's path is not a URL to follow anywhere — or
 * the file did not answer, so the next run tries again).
 */
export const posterFor = async (
  path: string,
  storage: IUploadProvider,
  extract: (url: string) => Promise<Buffer | null> = extractPosterFrame,
  isReachable: (url: string) => Promise<boolean> = reachable
): Promise<string | null> => {
  if (!isOwnMediaUrl(path)) return null;
  const local = localSource(path);
  const frame = await extract(local ?? path);
  if (!frame) {
    if (local) return NO_POSTER;
    return (await isReachable(path)) ? NO_POSTER : null;
  }
  const stored = await storage.uploadFile({
    buffer: frame,
    originalname: 'poster.jpg',
    mimetype: 'image/jpeg',
    size: frame.length,
    fieldname: 'file',
  } as unknown as Express.Multer.File);
  return stored.path as string;
};
