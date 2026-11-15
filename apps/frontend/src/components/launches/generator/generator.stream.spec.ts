import {
  GeneratorError,
  readGeneratorStream,
} from '@gitroom/frontend/components/launches/generator/generator.stream';

const readerOf = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const queue = chunks.map((c) => encoder.encode(c));
  return {
    read: async () =>
      queue.length
        ? { done: false, value: queue.shift() }
        : { done: true, value: undefined },
  };
};

const done = JSON.stringify({
  name: 'done',
  data: { output: { hook: 'Hook', content: [{ content: 'Żółć €' }], date: '2026-11-20T10:00:00' } },
});

describe('the post generator stream', () => {
  it('names each step and returns the posts on the last line', async () => {
    const steps: string[] = [];
    const output = await readGeneratorStream(
      readerOf(['{"name":"generate-hook"}\n', '{"name":"generate-content"}\n', done + '\n']),
      (name) => steps.push(name)
    );
    expect(steps).toEqual(['generate-hook', 'generate-content', 'done']);
    expect(output.content[0].content).toBe('Żółć €');
  });

  // nginx and the load balancer cut the stream where they like. The last
  // line cut in two was dropped whole: posts made, credits spent, and the
  // modal said "Could not generate the post".
  it('a line cut between two chunks is read whole, at every cut point', async () => {
    const whole = '{"name":"post-time"}\n' + done + '\n';
    const bytes = new TextEncoder().encode(whole);
    for (let cut = 1; cut < bytes.length; cut++) {
      const queue = [bytes.slice(0, cut), bytes.slice(cut)];
      const output = await readGeneratorStream(
        {
          read: async () =>
            queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined },
        },
        () => undefined
      );
      expect(output?.hook).toBe('Hook');
      expect(output?.content[0].content).toBe('Żółć €');
    }
  });

  it('reads a last line that has no line break after it', async () => {
    const output = await readGeneratorStream(readerOf([done]), () => undefined);
    expect(output.hook).toBe('Hook');
  });

  it("a failure the server reports in the stream is thrown with the server's words", async () => {
    await expect(
      readGeneratorStream(
        readerOf(['{"name":"generate-hook"}\n{"name":"error","message":"AI is unavailable right now."}\n']),
        () => undefined
      )
    ).rejects.toMatchObject({ message: 'AI is unavailable right now.' });
    await expect(
      readGeneratorStream(readerOf(['{"name":"error","message":""}\n']), () => undefined)
    ).rejects.toBeInstanceOf(GeneratorError);
  });

  it('a stream that ends without posts returns nothing', async () => {
    expect(await readGeneratorStream(readerOf(['{"name":"generate-hook"}\n']), () => undefined)).toBeUndefined();
  });
});
