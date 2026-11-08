import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * `Idempotency-Key` for requests that create something (the Stripe
 * convention). A client that timed out on a slow connection could not tell
 * whether the post was saved, and its retry saved it a second time. With the
 * same key the retry gets the first answer back instead of a second post.
 *
 * Opt-in: without the header the request runs as before. The key is scoped
 * to the organisation and kept for a day; a failed request releases it, so
 * the client can retry after fixing what was refused.
 */
const KEPT_FOR_SECONDS = 24 * 60 * 60;
// A request still running holds the key for at most this long.
const HELD_FOR_SECONDS = 5 * 60;
const KEY = /^[A-Za-z0-9_-]{8,128}$/;
const PENDING = 'pending';

const fingerprint = (body: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');

export async function withIdempotencyKey<T>(
  scope: string,
  orgId: string,
  key: string | undefined,
  body: unknown,
  run: () => Promise<T>
): Promise<T> {
  if (key === undefined || key === '') {
    return run();
  }
  if (!KEY.test(key)) {
    throw new BadRequestException(
      'Idempotency-Key must be 8 to 128 letters, digits, "-" or "_"'
    );
  }

  const id = `idempotency:${scope}:${orgId}:${key}`;
  const hash = fingerprint(body);
  const claimed = await ioRedis.set(
    id,
    JSON.stringify({ state: PENDING, hash }),
    'EX',
    HELD_FOR_SECONDS,
    'NX'
  );

  if (claimed !== 'OK') {
    const stored = JSON.parse((await ioRedis.get(id)) || 'null');
    if (!stored) {
      // Expired between the two calls: run it as a new request.
      return withIdempotencyKey(scope, orgId, key, body, run);
    }
    if (stored.hash !== hash) {
      throw new UnprocessableEntityException(
        'This Idempotency-Key was used for a different request'
      );
    }
    if (stored.state === PENDING) {
      throw new ConflictException(
        'A request with this Idempotency-Key is still being processed'
      );
    }
    return stored.result as T;
  }

  let result: T;
  try {
    result = await run();
  } catch (err) {
    await ioRedis.del(id);
    throw err;
  }
  await ioRedis.set(
    id,
    JSON.stringify({ state: 'done', hash, result: result ?? null }),
    'EX',
    KEPT_FOR_SECONDS
  );
  return result;
}
