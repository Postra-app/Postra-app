import { Redis } from 'ioredis';

// Create a mock Redis implementation for testing environments.
//
// It honours EX and NX, because callers use them to mean something: NX is how a
// caller claims a piece of work exactly once per window, and a mock that always
// says "OK" turns a throttled write into a write on every request.
class MockRedis {
  private data = new Map<string, { value: any; expiresAt: number | null }>();

  private live(key: string) {
    const entry = this.data.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string) {
    return this.live(key)?.value;
  }

  async set(key: string, value: any, ...args: any[]) {
    const flags = args.map((a) => String(a).toUpperCase());
    const exAt = flags.indexOf('EX');
    const ttlSeconds = exAt >= 0 ? Number(args[exAt + 1]) : null;

    if (flags.includes('NX') && this.live(key)) {
      return null;
    }
    if (flags.includes('XX') && !this.live(key)) {
      return null;
    }

    this.data.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
    return 'OK';
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) {
      if (this.data.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  // Add other Redis methods as needed for your tests
}

// Use real Redis if REDIS_URL is defined, otherwise use MockRedis
export const ioRedis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
    })
  : (new MockRedis() as unknown as Redis); // Type cast to Redis to maintain interface compatibility
