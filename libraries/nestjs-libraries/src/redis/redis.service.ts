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

  // Slot counters (upload-slots.guard.ts) give back with DECR.
  async decr(key: string) {
    const entry = this.live(key);
    const value = Number(entry?.value ?? 0) - 1;
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

  // Sorted sets: push receipts wait in one (mobile.push.service.ts). Without
  // them a send threw "not a function" after its first batch of 100.
  private zset(key: string): Map<string, number> {
    const entry = this.live(key);
    if (entry?.value instanceof Map) {
      return entry.value;
    }
    const value = new Map<string, number>();
    this.data.set(key, { value, expiresAt: null });
    return value;
  }

  async zadd(key: string, ...scoreMembers: (string | number)[]) {
    const set = this.zset(key);
    let added = 0;
    for (let i = 0; i + 1 < scoreMembers.length; i += 2) {
      const member = String(scoreMembers[i + 1]);
      if (!set.has(member)) added += 1;
      set.set(member, Number(scoreMembers[i]));
    }
    return added;
  }

  async zrangebyscore(key: string, min: number, max: number, ...args: any[]) {
    const members = [...this.zset(key).entries()]
      .filter(([, score]) => score >= Number(min) && score <= Number(max))
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
    const at = args.map((a) => String(a).toUpperCase()).indexOf('LIMIT');
    return at >= 0
      ? members.slice(Number(args[at + 1]), Number(args[at + 1]) + Number(args[at + 2]))
      : members;
  }

  async zremrangebyscore(key: string, min: number, max: number) {
    const set = this.zset(key);
    let removed = 0;
    for (const [member, score] of set) {
      if (score >= Number(min) && score <= Number(max)) {
        set.delete(member);
        removed += 1;
      }
    }
    return removed;
  }

  async zrem(key: string, ...members: string[]) {
    const set = this.zset(key);
    return members.filter((member) => set.delete(member)).length;
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
