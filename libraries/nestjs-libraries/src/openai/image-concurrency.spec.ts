import { createImageSlotGate } from '@gitroom/nestjs-libraries/openai/image-concurrency';

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

const fakeRedis = () => {
  const state = { value: 0 };
  return {
    state,
    incr: async () => ++state.value,
    decr: async () => --state.value,
    expire: async () => 1,
    set: async (_key: string, value: string) => {
      state.value = Number(value);
      return 'OK' as const;
    },
  };
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('shared image slot gate', () => {
  it('holds calls above the cluster cap until a slot frees up', async () => {
    const redis = fakeRedis();
    const gate = createImageSlotGate({
      redis: redis as any,
      max: 2,
      sleep: yieldToLoop,
    });

    const gates = [deferred(), deferred(), deferred()];
    let started = 0;
    const runs = gates.map((g) =>
      gate(async () => {
        started++;
        await g.promise;
        return 'done';
      })
    );

    await yieldToLoop();
    await yieldToLoop();
    expect(started).toBe(2);

    gates[0].resolve();
    await runs[0];
    await yieldToLoop();
    await yieldToLoop();
    expect(started).toBe(3);

    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
    expect(redis.state.value).toBe(0);
  });

  it('runs the call when Redis is unreachable', async () => {
    const gate = createImageSlotGate({
      redis: {
        incr: async () => {
          throw new Error('connection refused');
        },
        decr: async () => 0,
        expire: async () => 1,
        set: async () => 'OK',
      } as any,
      max: 1,
      sleep: yieldToLoop,
    });

    await expect(gate(async () => 'generated')).resolves.toBe('generated');
  });

  it('gives up on the cap rather than failing the image', async () => {
    const redis = fakeRedis();
    redis.state.value = 99; // cluster already saturated
    const gate = createImageSlotGate({
      redis: redis as any,
      max: 1,
      maxWaitMs: 0,
      sleep: yieldToLoop,
    });

    await expect(gate(async () => 'generated')).resolves.toBe('generated');
  });

  it('never leaves the counter negative when the key expired mid-call', async () => {
    const redis = fakeRedis();
    const gate = createImageSlotGate({
      redis: redis as any,
      max: 4,
      sleep: yieldToLoop,
    });

    await gate(async () => {
      redis.state.value = 0; // TTL fired while the image was generating
      return 'generated';
    });

    expect(redis.state.value).toBe(0);
  });
});
