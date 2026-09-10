import { isCancellation, RenderJobRunner } from './render-job';

const never = () => new Promise<never>(() => undefined);
const conversionCancelled = () => {
  const err = new Error('cancelled');
  err.name = 'ConversionCanceledError';
  return err;
};

describe('isCancellation', () => {
  it('recognises both pipelines’ way of saying it', () => {
    expect(isCancellation(new DOMException('Compose aborted', 'AbortError'))).toBe(
      true
    );
    expect(isCancellation(conversionCancelled())).toBe(true);
  });

  it('does not swallow a real failure', () => {
    expect(isCancellation(new Error('encoder blew up'))).toBe(false);
  });
});

describe('RenderJobRunner', () => {
  it('resolves with null instead of throwing when the pipeline aborts', async () => {
    const runner = new RenderJobRunner();
    const promise = runner.run(async (signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve())
      );
      throw new DOMException('Compose aborted', 'AbortError');
    });
    runner.cancel();
    expect(await promise).toBeNull();
    expect(runner.busy).toBe(false);
  });

  it('accepts the conversion’s own cancellation error too', async () => {
    const runner = new RenderJobRunner();
    const promise = runner.run(async () => {
      throw conversionCancelled();
    });
    expect(await promise).toBeNull();
  });

  it('tells the pipeline to stop, not just the signal', () => {
    const runner = new RenderJobRunner();
    const stop = jest.fn();
    runner.run(async (signal, register) => {
      register(stop);
      return never();
    });
    runner.cancel();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('drops a result that arrived after the user cancelled', async () => {
    const runner = new RenderJobRunner();
    let finish: (v: string) => void = () => undefined;
    const promise = runner.run(
      async () => new Promise<string>((resolve) => (finish = resolve))
    );
    runner.cancel();
    finish('a blob nobody asked for');
    expect(await promise).toBeNull();
  });

  it('throws a real failure through', async () => {
    const runner = new RenderJobRunner();
    await expect(
      runner.run(async () => {
        throw new Error('encoder blew up');
      })
    ).rejects.toThrow('encoder blew up');
    expect(runner.busy).toBe(false);
  });

  it('survives a stopper that rejects', () => {
    const runner = new RenderJobRunner();
    runner.run(async (signal, register) => {
      register(() => Promise.reject(new Error('already finalized')));
      return never();
    });
    expect(() => runner.cancel()).not.toThrow();
  });

  it('does nothing when there is no render to cancel', () => {
    expect(() => new RenderJobRunner().cancel()).not.toThrow();
  });

  it('reports the result of a render nobody cancelled', async () => {
    const runner = new RenderJobRunner();
    expect(await runner.run(async () => 'blob')).toBe('blob');
  });
});
