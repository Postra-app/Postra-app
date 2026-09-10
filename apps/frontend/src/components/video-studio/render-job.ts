/**
 * A render the user can call off.
 *
 * Every tab in the video studio could start a render and none of them could
 * stop one: a three-minute clip on a laptop held the tab, the fans and the
 * modal until it finished. Two of the pipelines already watched an
 * `AbortSignal`, but nothing ever created one.
 *
 * The runner is deliberately plain (no React): the tabs each keep their own
 * busy/progress state, and this is the part worth testing on its own.
 */
export type RegisterCancel = (stop: () => void | Promise<void>) => void;

/** True for both ways a pipeline reports "you cancelled this". */
export const isCancellation = (err: unknown): boolean =>
  (err instanceof DOMException && err.name === 'AbortError') ||
  (err instanceof Error && err.name === 'ConversionCanceledError');

export class RenderJobRunner {
  private controller: AbortController | null = null;
  private stoppers: (() => void | Promise<void>)[] = [];

  /** A render is in flight. */
  get busy(): boolean {
    return this.controller !== null;
  }

  /**
   * Run a render. Resolves with `null` when it was cancelled, so the caller
   * writes `if (!result) return;` instead of catching an abort.
   */
  async run<T>(
    fn: (signal: AbortSignal, register: RegisterCancel) => Promise<T>
  ): Promise<T | null> {
    const ac = new AbortController();
    this.controller = ac;
    this.stoppers = [];
    try {
      const result = await fn(ac.signal, (stop) => {
        this.stoppers.push(stop);
      });
      // A pipeline that finished its last frame after the abort still
      // resolves; the user asked for nothing, so give them nothing.
      return ac.signal.aborted ? null : result;
    } catch (err) {
      if (isCancellation(err) || ac.signal.aborted) {
        return null;
      }
      throw err;
    } finally {
      if (this.controller === ac) {
        this.controller = null;
        this.stoppers = [];
      }
    }
  }

  cancel(): void {
    if (!this.controller) return;
    this.controller.abort();
    // An `execute()` already running never looks at the signal — the pipeline
    // itself has to be told. Failures here are ignored on purpose: the render
    // is going away either way, and a stopper that rejects (already finalized,
    // say) must not replace the cancellation the caller is about to see.
    for (const stop of this.stoppers) {
      try {
        Promise.resolve(stop()).catch(() => undefined);
      } catch {
        /* nothing left to do */
      }
    }
  }
}
