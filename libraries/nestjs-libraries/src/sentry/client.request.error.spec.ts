import { Readable } from 'stream';
import getRawBody from 'raw-body';
import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent, EventHint } from '@sentry/nestjs';
import { initializeSentry } from './initialize.sentry';
import { isClientRequestError } from './client.request.error';

// The errors body-parser hands to Nest come from raw-body (size, aborts) and
// from body-parser itself (bad JSON). Built here by the libraries, not by
// hand, so a change of their shape breaks this test.
const rawBodyError = async (body: Buffer, limit: number): Promise<unknown> => {
  try {
    await getRawBody(Readable.from([body]), { limit, length: body.length });
  } catch (error) {
    return error;
  }
  throw new Error('raw-body accepted the body');
};

const event = { type: undefined } as ErrorEvent;

describe('isClientRequestError', () => {
  it('drops the 413 of a body over the limit (a 3 MB POST to /copilot/agent)', async () => {
    const error = await rawBodyError(Buffer.alloc(3 * 1024 * 1024), 2 * 1024 * 1024);
    expect(error).toMatchObject({ status: 413, type: 'entity.too.large' });
    expect(isClientRequestError(error)).toBe(true);
  });

  it('drops malformed JSON a client sent (400 entity.parse.failed)', () => {
    let error: unknown;
    try {
      JSON.parse('{"a":');
    } catch (e) {
      // What body-parser's json() wraps it in: http-errors 400 with a type.
      error = Object.assign(e as Error, { status: 400, statusCode: 400, expose: true, type: 'entity.parse.failed' });
    }
    expect(isClientRequestError(error)).toBe(true);
  });

  it('keeps a body-parser fault on our side (5xx type)', () => {
    const error = Object.assign(new Error('stream is not readable'), {
      status: 500,
      type: 'stream.not.readable',
    });
    expect(isClientRequestError(error)).toBe(false);
  });

  it('keeps an app error that merely carries a 4xx status', () => {
    const error = Object.assign(new Error('Payment required'), { status: 402 });
    expect(isClientRequestError(error)).toBe(false);
  });

  it('keeps anything that is not an error object', () => {
    expect(isClientRequestError(undefined)).toBe(false);
    expect(isClientRequestError('entity.too.large')).toBe(false);
  });

  it('is what the backend beforeSend uses', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@127.0.0.1:9/1';
    expect(initializeSentry('backend')).toBe(true);
    const beforeSend = Sentry.getClient()!.getOptions().beforeSend!;
    const tooLarge = await rawBodyError(Buffer.alloc(16), 8);
    expect(await beforeSend(event, { originalException: tooLarge } as EventHint)).toBeNull();
    const real = new Error('database is down');
    expect(await beforeSend(event, { originalException: real } as EventHint)).toBe(event);
  });
});
