// Without REDIS_URL the app runs on the in-memory stand-in. It had no sorted
// sets, so a push send stopped after its first batch of 100 ("zadd is not a
// function").
describe('the in-memory Redis stand-in', () => {
  const load = () => {
    delete process.env.REDIS_URL;
    let ioRedis: any;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ioRedis = require('./redis.service').ioRedis;
    });
    return ioRedis;
  };

  it('keeps a sorted set: add, range by score with a limit, remove', async () => {
    const r = load();
    expect(await r.zadd('k', 3, 'c', 1, 'a', 2, 'b')).toBe(3);
    expect(await r.zrangebyscore('k', 0, 2)).toEqual(['a', 'b']);
    expect(await r.zrangebyscore('k', 0, 10, 'LIMIT', 1, 1)).toEqual(['b']);
    expect(await r.zrem('k', 'a', 'zz')).toBe(1);
    expect(await r.zremrangebyscore('k', 0, 2)).toBe(1);
    expect(await r.zrangebyscore('k', 0, 10)).toEqual(['c']);
  });
});
