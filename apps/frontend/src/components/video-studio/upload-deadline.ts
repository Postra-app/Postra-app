/**
 * How long an upload of `bytes` may take before it is given up.
 *
 * Requests stop after 120 seconds unless they bring their own signal, and a
 * 150 MB clip on a home connection (5 to 10 Mb/s up) needs longer than that:
 * it failed with "Upload failed." every time. The deadline grows with the
 * file, as if the connection did at least 0.5 Mb/s, so a dead connection
 * still ends the wait.
 */
export const MIN_UPLOAD_MS = 120_000;
const SLOWEST_BYTES_PER_SECOND = 62_500;

export const uploadDeadlineMs = (bytes: number): number =>
  Math.max(MIN_UPLOAD_MS, Math.ceil((bytes / SLOWEST_BYTES_PER_SECOND) * 1000));

/** A signal that aborts after the file's deadline; `done` clears the timer. */
export const uploadSignal = (bytes: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), uploadDeadlineMs(bytes));
  return { signal: controller.signal, done: () => clearTimeout(timer) };
};
