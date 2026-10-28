import { Logger } from '@nestjs/common';

// The part of a Temporal Worker this module needs; the real one satisfies it.
export interface DrainableWorker {
  getState(): string;
  shutdown(): void;
}

// A worker in one of these is doing no work: never started, finished
// draining, or given up on by the SDK (shutdownForceTime).
const IDLE = new Set(['INITIALIZED', 'STOPPED', 'FAILED']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Asks every running worker to stop taking tasks and waits until each has
 * finished the ones it holds, or the deadline passes. True when all are idle.
 */
export async function drainWorkers(
  workers: DrainableWorker[],
  deadlineMs: number,
  pollMs = 250
): Promise<boolean> {
  for (const worker of workers) {
    // Temporal's own signal handler may have got there first.
    if (worker.getState() === 'RUNNING') worker.shutdown();
  }
  const until = Date.now() + deadlineMs;
  while (workers.some((w) => !IDLE.has(w.getState()))) {
    if (Date.now() >= until) return false;
    await sleep(pollMs);
  }
  return true;
}

/**
 * SIGTERM/SIGINT handling for the orchestrator, in place of Nest's
 * enableShutdownHooks. Nest runs onModuleDestroy first, where
 * nestjs-temporal-core calls worker.shutdown() without waiting for the drain
 * and closes the connection the workers report through; then it re-raises the
 * signal and the process dies with activities still in flight. Here the
 * workers drain first, then the app closes, then the process exits.
 */
export function exitAfterDrain(
  close: () => Promise<void>,
  workers: () => DrainableWorker[],
  deadlineMs: number,
  exit: (code: number) => void = (code) => process.exit(code)
) {
  let started = false;
  const onSignal = async (signal: NodeJS.Signals) => {
    if (started) return;
    started = true;
    const t0 = Date.now();
    Logger.log(`${signal}: draining Temporal workers`, 'Shutdown');
    const drained = await drainWorkers(workers(), deadlineMs);
    Logger.log(
      `workers ${drained ? 'drained' : 'still busy at the deadline'} in ${
        Date.now() - t0
      } ms`,
      'Shutdown'
    );
    try {
      await close();
    } catch (err) {
      Logger.error(`close failed: ${err}`, 'Shutdown');
    }
    exit(drained ? 0 : 1);
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, onSignal);
  }
  return onSignal;
}
