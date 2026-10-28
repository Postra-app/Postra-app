import { drainWorkers, exitAfterDrain, DrainableWorker } from './shutdown';

// A worker that takes `drainMs` to finish its tasks once asked to stop
// (Infinity: never finishes).
const worker = (drainMs: number, state = 'RUNNING') => {
  const w = {
    state,
    stopCalls: 0,
    getState: () => w.state,
    shutdown: () => {
      if (w.state !== 'RUNNING') throw new Error(`Not running: ${w.state}`);
      w.stopCalls++;
      w.state = 'DRAINING';
      if (drainMs !== Infinity) setTimeout(() => (w.state = 'STOPPED'), drainMs);
    },
  };
  return w;
};

describe('drainWorkers', () => {
  it('waits for every worker to finish what it holds', async () => {
    const fast = worker(10);
    const slow = worker(300);
    const t0 = Date.now();
    await expect(drainWorkers([fast, slow], 5_000, 10)).resolves.toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
    expect([fast.state, slow.state]).toEqual(['STOPPED', 'STOPPED']);
  });

  it('does not stop a worker twice when Temporal already did', async () => {
    const w = worker(10);
    w.shutdown(); // Runtime's own SIGTERM handler
    await expect(drainWorkers([w], 1_000, 10)).resolves.toBe(true);
    expect(w.stopCalls).toBe(1);
  });

  it('gives up at the deadline', async () => {
    const stuck = worker(Infinity);
    await expect(drainWorkers([stuck], 100, 10)).resolves.toBe(false);
  });

  it('counts never-started and failed workers as idle', async () => {
    await expect(
      drainWorkers([worker(0, 'INITIALIZED'), worker(0, 'FAILED')], 100, 10)
    ).resolves.toBe(true);
  });
});

describe('exitAfterDrain', () => {
  const listeners = () => ({
    term: process.listeners('SIGTERM'),
    int: process.listeners('SIGINT'),
  });
  let before: ReturnType<typeof listeners>;
  beforeEach(() => (before = listeners()));
  afterEach(() => {
    for (const s of ['SIGTERM', 'SIGINT'] as const) {
      for (const l of process.listeners(s)) {
        if (!(s === 'SIGTERM' ? before.term : before.int).includes(l)) {
          process.off(s, l);
        }
      }
    }
  });

  it('closes the app only after the workers drained, then exits 0', async () => {
    const order: string[] = [];
    const w = worker(200);
    const drained = new Promise<number>((resolve) => {
      const onSignal = exitAfterDrain(
        async () => {
          order.push(`close:${w.state}`);
        },
        () => [w as DrainableWorker],
        5_000,
        resolve
      );
      onSignal('SIGTERM');
      onSignal('SIGINT'); // pm2 or a second signal: ignored
    });
    await expect(drained).resolves.toBe(0);
    expect(order).toEqual(['close:STOPPED']);
    expect(w.stopCalls).toBe(1);
  });

  it('exits 1 when a worker is still busy at the deadline', async () => {
    const code = await new Promise<number>((resolve) => {
      exitAfterDrain(async () => {}, () => [worker(Infinity)], 100, resolve)(
        'SIGTERM'
      );
    });
    expect(code).toBe(1);
  });

  it('listens on SIGTERM and SIGINT', () => {
    exitAfterDrain(async () => {}, () => [], 100, () => {});
    expect(process.listeners('SIGTERM').length).toBe(before.term.length + 1);
    expect(process.listeners('SIGINT').length).toBe(before.int.length + 1);
  });
});
