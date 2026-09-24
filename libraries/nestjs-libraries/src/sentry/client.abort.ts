import type { ErrorEvent } from '@sentry/nestjs';

/**
 * Multer's own errors for a client that hung up mid-upload
 * (`multer/lib/make-middleware.js`, `req.on('aborted' | 'close')`).
 *
 * Deliberately NOT 'Request error': that one wraps a real socket fault.
 */
const CLIENT_ABORT_MESSAGES = new Set(['Request aborted', 'Request closed']);

/**
 * True when the event is only a client giving up on an upload.
 *
 * A phone on a slow link gives up after its own 60 s limit, or the user leaves
 * the screen; multer then throws a plain `Error`, which `SentryGlobalFilter`
 * reports as a 500 nobody is left to receive. Seen 2026-09-24 as
 * "Error: Request aborted" on `POST /media/upload-simple` — three events, all
 * from the throttled-upload test in the mobile e2e session (okhttp, x-client
 * mobile). Real users on poor signal would do the same, and every one of those
 * would spend the free Sentry quota on noise.
 *
 * The match is narrow on purpose: the exact multer message AND a multer frame.
 * An app error that happens to say "Request aborted" still gets reported.
 */
export function isClientAbort(event: ErrorEvent): boolean {
  return (event.exception?.values ?? []).some(
    (value) =>
      value.type === 'Error' &&
      CLIENT_ABORT_MESSAGES.has(value.value ?? '') &&
      (value.stacktrace?.frames ?? []).some((frame) =>
        (frame.filename ?? frame.abs_path ?? '').includes('/multer/')
      )
  );
}
