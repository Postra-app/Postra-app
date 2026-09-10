import pLimit from 'p-limit';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Concurrency gate for image generation, shared by every process that can call
 * the image model.
 *
 * The cap used to be a bare `pLimit` inside OpenaiService, which is per
 * PROCESS: the backend serves the composer and Studio, the orchestrator runs
 * AutoPost and the Creator, so the real ceiling was twice the number anyone
 * read in the code. Counting in Redis makes the configured number mean what it
 * says across the cluster.
 *
 * Failure is always open: if Redis is unreachable, or the queue is longer than
 * the wait budget, the call goes through and the per-process limit plus the
 * OpenAI SDK's own 429 backoff are the remaining guard. Metering must never be
 * the reason an image fails.
 */

export interface ImageSlotGateOptions {
  redis: Pick<typeof ioRedis, 'incr' | 'decr' | 'expire' | 'set'>;
  max: number;
  /** Seconds a leaked slot survives if a process dies mid-generation. */
  slotTtl?: number;
  /** How long to queue before giving up on the shared cap and proceeding. */
  maxWaitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const KEY = 'openai:image:inflight';
const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createImageSlotGate = (options: ImageSlotGateOptions) => {
  const {
    redis,
    max,
    slotTtl = 180,
    maxWaitMs = 120_000,
    pollMs = 500,
    sleep = defaultSleep,
  } = options;

  const release = async () => {
    try {
      const left = await redis.decr(KEY);
      // The key can expire while slots are held (a long generation, a dead
      // process). Never let the counter go negative — that would silently
      // raise the cap for everyone afterwards.
      if (left < 0) await redis.set(KEY, '0');
    } catch {
      // A slot we cannot return expires on its own via slotTtl.
    }
  };

  const noop = async () => {
    /* nothing was taken, nothing to give back */
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + maxWaitMs;
    let giveBack = noop;

    for (;;) {
      let inFlight: number;
      try {
        inFlight = await redis.incr(KEY);
        await redis.expire(KEY, slotTtl);
      } catch {
        break; // no Redis — run under the per-process limit only
      }

      if (inFlight <= max) {
        giveBack = release;
        break;
      }

      await release();
      if (Date.now() >= deadline) break;
      await sleep(pollMs);
    }

    try {
      return await fn();
    } finally {
      await giveBack();
    }
  };
};

// Cap concurrent image generations across the cluster, not per process.
const CLUSTER_MAX = Number(process.env.OPENAI_IMAGE_CONCURRENCY) || 4;
const perProcessLimit = pLimit(CLUSTER_MAX);
const sharedGate = createImageSlotGate({ redis: ioRedis, max: CLUSTER_MAX });

export const withImageSlot = <T>(fn: () => Promise<T>): Promise<T> =>
  perProcessLimit(() => sharedGate(fn));
