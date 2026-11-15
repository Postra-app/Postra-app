// Reads the post generator's response: one JSON object per line, a step name
// while the graph runs and the posts on the last line.

/** The server said, in the stream, that the run failed (and maybe why). */
export class GeneratorError extends Error {}

type Reader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
};

export const readGeneratorStream = async (
  reader: Reader,
  onStep: (name: string) => void
): Promise<any> => {
  const decoder = new TextDecoder('utf-8');
  let last: any = {};
  // A line can arrive in two network chunks (a proxy cuts the stream where it
  // likes): the unfinished end waits for the next read. Parsed chunk by
  // chunk, a split last line was dropped and finished posts read as a failure.
  let pending = '';
  const take = (line: string) => {
    if (!line || line.indexOf('{') === -1) return;
    let data: any;
    try {
      data = JSON.parse(line);
    } catch (e) {
      return;
    }
    if (data?.name === 'error') {
      throw new GeneratorError(data.message || '');
    }
    if (typeof data?.name === 'string') {
      onStep(data.name);
    }
    last = data;
  };
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split('\n');
    // The stream can end without a final line break.
    pending = done ? '' : lines.pop() || '';
    lines.forEach(take);
    if (done) return last?.data?.output;
  }
};
