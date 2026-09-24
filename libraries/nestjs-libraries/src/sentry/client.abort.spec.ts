import type { ErrorEvent } from '@sentry/nestjs';
import { isClientAbort } from './client.abort';

// Frames trimmed from the real event (Sentry issue 149168968, 2026-09-24):
// POST /media/upload-simple, okhttp, the phone gave up after 60 s.
const MULTER_FRAME = {
  filename:
    '/app/node_modules/@nestjs/platform-express/node_modules/multer/lib/make-middleware.js',
  function: 'IncomingMessage.?',
  lineno: 118,
};
const NODE_FRAME = {
  filename: 'node:_http_server',
  function: 'abortIncoming',
  lineno: 825,
};

const event = (
  value: string,
  frames: Array<Record<string, unknown>> = [NODE_FRAME, MULTER_FRAME],
  type = 'Error'
): ErrorEvent =>
  ({
    type: undefined,
    exception: { values: [{ type, value, stacktrace: { frames } }] },
  } as ErrorEvent);

describe('isClientAbort', () => {
  it('drops the multer abort seen in production', () => {
    expect(isClientAbort(event('Request aborted'))).toBe(true);
  });

  it('drops the close variant multer throws for the same hang-up', () => {
    expect(isClientAbort(event('Request closed'))).toBe(true);
  });

  it('keeps a real socket fault that multer wraps as "Request error"', () => {
    expect(isClientAbort(event('Request error'))).toBe(false);
  });

  it('keeps an app error that merely says "Request aborted"', () => {
    const appFrame = {
      filename: '/app/apps/backend/dist/main.js',
      function: 'MediaController.uploadSimple',
    };
    expect(isClientAbort(event('Request aborted', [appFrame]))).toBe(false);
  });

  it('keeps anything that is not a plain Error', () => {
    expect(isClientAbort(event('Request aborted', undefined, 'TypeError'))).toBe(false);
  });

  it('keeps events without an exception', () => {
    expect(isClientAbort({ type: undefined } as ErrorEvent)).toBe(false);
  });
});
