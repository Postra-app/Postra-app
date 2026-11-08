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
  },
}));

import { withIdempotencyKey } from './idempotency';

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

it('a request still running answers 409 to its retry', async () => {
  let release!: () => void;
  const slow = withIdempotencyKey('posts', 'o1', 'key-12345', {}, () => new Promise((r) => (release = () => r({ id: 1 }))));
  await new Promise((r) => setImmediate(r));
  await expect(withIdempotencyKey('posts', 'o1', 'key-12345', {}, async () => ({}))).rejects.toMatchObject({ status: 409 });
  release();
  await slow;
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
