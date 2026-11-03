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

  // Callers ask whether a key is there without caring what is in it — the
  // mobile session deny list does exactly that. Without this the mock throws
  // "not a function", every caller's catch swallows it, and the check silently
  // answers "not revoked" for the whole test run.
  async exists(...keys: string[]) {
    return keys.filter((key) => this.live(key)).length;
  }

  async expire(key: string, seconds: number) {
    const entry = this.live(key);
    if (!entry) {
      return 0;
    }
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
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

  // Failure counters (sign-in lockout, an administrator's second step) count
  // with INCR and keep the key's expiry, as Redis does.
  async incr(key: string) {
    const entry = this.live(key);
    const value = Number(entry?.value ?? 0) + 1;
    this.data.set(key, {
      value: String(value),
      expiresAt: entry?.expiresAt ?? null,
    });
    return value;
  }

  // Seconds left; -1 without an expiry, -2 for no key.
  async ttl(key: string) {
    const entry = this.live(key);
    if (!entry) {
      return -2;
    }
    if (entry.expiresAt === null) {
      return -1;
    }
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
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
