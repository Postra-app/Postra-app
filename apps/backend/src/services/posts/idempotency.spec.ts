const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string, _ex: string, _ttl: number, nx?: string) => {
      if (nx === 'NX' && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    // The three compare-and-change scripts: act only while the claim is ours.
    eval: jest.fn(async (script: string, _n: number, k: string, claim: string, ...rest: unknown[]) => {
      if (store.get(k) !== claim) return 0;
      if (script.includes("'expire'")) return 1;
      if (script.includes("'set'")) store.set(k, String(rest[0]));
      else store.delete(k);
      return 1;
    }),
  },
}));

import { isStoredReplay, withIdempotencyKey } from './idempotency';

// A retry after a timeout saved the same post twice. With a key, the retry
// gets the first answer back.
beforeEach(() => store.clear());

it('without a key every request runs', async () => {
  const run = jest.fn(async () => ({ id: 1 }));
  await withIdempotencyKey('posts', 'o1', undefined, {}, run);
  await withIdempotencyKey('posts', 'o1', undefined, {}, run);
  expect(run).toHaveBeenCalledTimes(2);
});

it('a retry with the same key and body returns the first result and creates nothing', async () => {
  let n = 0;
  const run = jest.fn(async () => ({ id: ++n }));
  const first = await withIdempotencyKey('posts', 'o1', 'key-12345', { a: 1 }, run);
  const again = await withIdempotencyKey('posts', 'o1', 'key-12345', { a: 1 }, run);
  expect(run).toHaveBeenCalledTimes(1);
  expect(again).toEqual(first);
  expect(await isStoredReplay('posts', 'o1', 'key-12345', { a: 1 })).toBe(true);
  expect(await isStoredReplay('posts', 'o1', 'key-12345', { a: 2 })).toBe(false);
  expect(await isStoredReplay('posts', 'o2', 'key-12345', { a: 1 })).toBe(false);
});

it('the same key from another organisation is a different request', async () => {
  const run = jest.fn(async () => ({}));
  await withIdempotencyKey('posts', 'o1', 'key-12345', {}, run);
  await withIdempotencyKey('posts', 'o2', 'key-12345', {}, run);
  expect(run).toHaveBeenCalledTimes(2);
});

it('the same key with a different body is refused', async () => {
  await withIdempotencyKey('posts', 'o1', 'key-12345', { a: 1 }, async () => ({}));
  await expect(withIdempotencyKey('posts', 'o1', 'key-12345', { a: 2 }, async () => ({}))).rejects.toMatchObject({ status: 422 });
});

it('a request still running answers 409 to its retry, and is not a stored replay', async () => {
  let release!: () => void;
  const slow = withIdempotencyKey('posts', 'o1', 'key-12345', {}, () => new Promise((r) => (release = () => r({ id: 1 }))));
  await new Promise((r) => setImmediate(r));
  await expect(withIdempotencyKey('posts', 'o1', 'key-12345', {}, async () => ({}))).rejects.toMatchObject({ status: 409 });
  expect(await isStoredReplay('posts', 'o1', 'key-12345', {})).toBe(false);
  release();
  await slow;
});

it('a slow request keeps its claim while it runs', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  try {
    const { ioRedis } = jest.requireMock('@gitroom/nestjs-libraries/redis/redis.service');
    let release!: () => void;
    const slow = withIdempotencyKey('posts', 'o1', 'key-12345', {}, () => new Promise((r) => (release = () => r({ id: 1 }))));
    await new Promise((r) => setImmediate(r));
    jest.advanceTimersByTime(5 * 60_000);
    const renewals = ioRedis.eval.mock.calls.filter(([s]: [string]) => s.includes("'expire'")).length;
    expect(renewals).toBeGreaterThanOrEqual(10);
    release();
    await slow;
  } finally {
    jest.useRealTimers();
  }
});

it('a request whose claim was lost does not overwrite the one that took the key over', async () => {
  let release!: () => void;
  const slow = withIdempotencyKey('posts', 'o1', 'key-12345', {}, () => new Promise((r) => (release = () => r({ id: 'first' }))));
  await new Promise((r) => setImmediate(r));
  // The claim expired (a stalled process) and a retry took the key over.
  store.delete('idempotency:posts:o1:key-12345');
  const retry = await withIdempotencyKey('posts', 'o1', 'key-12345', {}, async () => ({ id: 'retry' }));
  release();
  await slow;
  expect(retry).toEqual({ id: 'retry' });
  expect(JSON.parse(store.get('idempotency:posts:o1:key-12345')!).result).toEqual({ id: 'retry' });
});

it('a failed request releases the key, so the fixed retry runs', async () => {
  await expect(
    withIdempotencyKey('posts', 'o1', 'key-12345', {}, async () => {
      throw new Error('refused');
    })
  ).rejects.toThrow('refused');
  const run = jest.fn(async () => ({ id: 2 }));
  expect(await withIdempotencyKey('posts', 'o1', 'key-12345', {}, run)).toEqual({ id: 2 });
});

it('a malformed key is a 400', async () => {
  await expect(withIdempotencyKey('posts', 'o1', 'short', {}, async () => ({}))).rejects.toMatchObject({ status: 400 });
});
