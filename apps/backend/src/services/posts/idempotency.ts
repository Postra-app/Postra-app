import { createHash, randomUUID } from 'node:crypto';
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
// The claim of a request still running; renewed while it runs, so a slow
// save cannot lose it to a retry, and gone soon after a crash.
const HELD_FOR_SECONDS = 60;
const RENEW_EVERY_MS = 20_000;
const KEY = /^[A-Za-z0-9_-]{8,128}$/;

// Each changes the key only while it still holds this request's claim, so a
// request whose claim was lost cannot overwrite or free another one's.
const RENEW =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) end return 0";
const FINISH =
  "if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]) return 1 end return 0";
const RELEASE =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

const fingerprint = (body: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');

const redisKey = (scope: string, orgId: string, key: string) =>
  `idempotency:${scope}:${orgId}:${key}`;

const validKey = (key: string | undefined): key is string => {
  if (key === undefined || key === '') {
    return false;
  }
  if (!KEY.test(key)) {
    throw new BadRequestException(
      'Idempotency-Key must be 8 to 128 letters, digits, "-" or "_"'
    );
  }
  return true;
};

/**
 * Whether this request is a retry whose result is already stored — it
 * creates nothing, so a limit on new posts must not refuse it.
 */
export async function isStoredReplay(
  scope: string,
  orgId: string,
  key: string | undefined,
  body: unknown
): Promise<boolean> {
  if (key === undefined || key === '' || !KEY.test(key)) {
    return false;
  }
  const stored = JSON.parse(
    (await ioRedis.get(redisKey(scope, orgId, key))) || 'null'
  );
  return stored?.state === 'done' && stored.hash === fingerprint(body);
}

export async function withIdempotencyKey<T>(
  scope: string,
  orgId: string,
  key: string | undefined,
  body: unknown,
  run: () => Promise<T>
): Promise<T> {
  if (!validKey(key)) {
    return run();
  }

  const id = redisKey(scope, orgId, key);
  const hash = fingerprint(body);
  const claim = JSON.stringify({ state: 'pending', hash, by: randomUUID() });
  const claimed = await ioRedis.set(id, claim, 'EX', HELD_FOR_SECONDS, 'NX');

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
    if (stored.state === 'pending') {
      throw new ConflictException(
        'A request with this Idempotency-Key is still being processed'
      );
    }
    return stored.result as T;
  }

  const renew = setInterval(() => {
    ioRedis.eval(RENEW, 1, id, claim, HELD_FOR_SECONDS).catch((): undefined => undefined);
  }, RENEW_EVERY_MS);
  renew.unref?.();

  let result: T;
  try {
    result = await run();
  } catch (err) {
    clearInterval(renew);
    await ioRedis.eval(RELEASE, 1, id, claim);
    throw err;
  }
  clearInterval(renew);
  await ioRedis.eval(
    FINISH,
    1,
    id,
    claim,
    JSON.stringify({ state: 'done', hash, result: result ?? null }),
    KEPT_FOR_SECONDS
  );
  return result;
}
