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
      ? members.slice(
          Number(args[at + 1]),
          Number(args[at + 1]) + Number(args[at + 2])
        )
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

// How long one command may take. Redis answers in under a millisecond; a
// command that has waited this long is not going to be answered.
export const REDIS_COMMAND_TIMEOUT_MS = 2000;
// A connection that owes an answer and has delivered nothing for this long is
// dropped and reopened: the other end is gone without saying so (the host
// died, a firewall dropped the flow) and the kernel would keep the socket for
// minutes. Reconnecting moves the client out of "ready", which redisReady()
// shows to callers, instead of every command paying the full timeout.
export const REDIS_SOCKET_TIMEOUT_MS = 5000;

/**
 * The client retries a command forever (`maxRetriesPerRequest: null`) and
 * queues commands while it is disconnected, so without a time limit a command
 * sent while Redis is down never settles: not resolved, not rejected. Every
 * `.catch()` written to "fail open" was dead code, and with Redis stopped
 * every signed-in request hung until the load balancer gave up, while the
 * liveness check stayed green. Now a command without a connection rejects
 * at once, one on a connection that stopped answering after
 * REDIS_COMMAND_TIMEOUT_MS, and each caller's own handling decides: caches
 * fall back to the database, locks and rate limits refuse.
 */
export const redisOptions = {
  maxRetriesPerRequest: null as null,
  connectTimeout: 10000,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  socketTimeout: REDIS_SOCKET_TIMEOUT_MS,
  // A command sent while there is no connection is refused at once and never
  // queued. Queued, it was only *reported* failed when its time ran out: the
  // client still sent it once Redis was back. An INCR its caller had given
  // up on then ran with nobody left to set its expiry or to take it back (a
  // counter of failed sign-ins or of running jobs, stuck for good).
  enableOfflineQueue: false,
};

export const connectRedis = (url: string, options = redisOptions) => {
  // Until the first connection is up, commands wait for it as they always
  // did: code that runs right after import (a script, a spec) must not be
  // refused for being a few milliseconds early. From then on a command
  // without a connection is refused (see enableOfflineQueue above).
  const client = new Redis(url, { ...options, enableOfflineQueue: true });
  client.once('ready', () => {
    client.options.enableOfflineQueue = options.enableOfflineQueue;
  });
  // One line per outage, not one per retry (and never the URL: it carries
  // the password).
  let down = false;
  client.on('error', (err: Error) => {
    if (down) return;
    down = true;
    console.error(`[redis] connection error: ${err?.message || err}`);
  });
  client.on('ready', () => {
    if (down) console.log('[redis] connection restored');
    down = false;
  });
  return client;
};

// Use real Redis if REDIS_URL is defined, otherwise use MockRedis
export const ioRedis = process.env.REDIS_URL
  ? connectRedis(process.env.REDIS_URL)
  : (new MockRedis() as unknown as Redis); // Type cast to Redis to maintain interface compatibility

/**
 * False while the client knows it has no connection. For paths that can do
 * without Redis (the auth context cache, the last-seen stamp): they skip it
 * at once instead of waiting out the command timeout on every request.
 */
export const redisReady = () =>
  !process.env.REDIS_URL || ioRedis.status === 'ready';
