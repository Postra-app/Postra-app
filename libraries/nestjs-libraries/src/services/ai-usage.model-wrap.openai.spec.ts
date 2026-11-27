import { createOpenAI } from '@ai-sdk/openai';
import { AiUsageEvent, setAiUsageSink } from './ai-usage.record';
import { meterLanguageModel } from './ai-usage.model-wrap';

// The assistant's model is the real @ai-sdk/openai provider wrapped by
// meterLanguageModel. These tests run that provider against a stubbed
// Responses API, so a provider upgrade that changes the model spec or the
// shape of its usage report shows up here, not as zeros in AiUsage.

const responseBody = {
  id: 'resp_1',
  object: 'response',
  created_at: 1795800000,
  status: 'completed',
  model: 'gpt-5.5',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 14000,
    input_tokens_details: { cached_tokens: 12800 },
    output_tokens: 300,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 14300,
  },
};

const sse = (events: object[]) =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';

function stubbedProvider(stream: boolean) {
  const fetch = async () =>
    stream
      ? new Response(
          sse([
            { type: 'response.created', sequence_number: 0, response: { ...responseBody, status: 'in_progress', output: [], usage: null } },
            { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { type: 'message', id: 'msg_1', status: 'in_progress', role: 'assistant', content: [] } },
            { type: 'response.output_text.delta', sequence_number: 2, item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Hello', logprobs: [] },
            { type: 'response.output_item.done', sequence_number: 3, output_index: 0, item: responseBody.output[0] },
            { type: 'response.completed', sequence_number: 4, response: responseBody },
          ]),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      : new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
  return createOpenAI({ apiKey: 'test', fetch: fetch as any });
}

const prompt = [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }];

describe('metered @ai-sdk/openai model', () => {
  let events: AiUsageEvent[];
  beforeEach(() => {
    events = [];
    setAiUsageSink((e) => events.push(e));
  });

  it('speaks the model spec of the current AI SDK', () => {
    const model = meterLanguageModel(stubbedProvider(false)('gpt-5.5'), 'agent');
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toBe('openai.responses');
    expect(model.modelId).toBe('gpt-5.5');
  });

  it('records input, output and cached tokens of a generated answer', async () => {
    const model = meterLanguageModel(stubbedProvider(false)('gpt-5.5'), 'agent');
    const result: any = await model.doGenerate({ prompt } as any);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'Hello' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      engine: 'agent',
      model: 'gpt-5.5',
      inputAmount: 14000,
      outputAmount: 300,
      cachedAmount: 12800,
    });
  });

  // The assistant hands this model to a Mastra Agent, which must accept the
  // provider's spec version: run a whole generate and stream through it.
  it('runs inside a Mastra Agent, generated and streamed', async () => {
    const { Agent } = await import('@mastra/core/agent');
    const agent = new Agent({
      id: 'test',
      name: 'test',
      instructions: 'Answer briefly.',
      model: meterLanguageModel(stubbedProvider(false)('gpt-5.5'), 'agent') as any,
    });
    const generated = await agent.generate('Hi');
    expect(generated.text).toBe('Hello');

    const streaming = new Agent({
      id: 'test-stream',
      name: 'test-stream',
      instructions: 'Answer briefly.',
      model: meterLanguageModel(stubbedProvider(true)('gpt-5.5'), 'agent') as any,
    });
    const streamed = await streaming.stream('Hi');
    expect(await streamed.text).toBe('Hello');

    expect(events.map((e) => [e.inputAmount, e.outputAmount, e.cachedAmount])).toEqual([
      [14000, 300, 12800],
      [14000, 300, 12800],
    ]);
  });

  it('records the same numbers from a streamed answer', async () => {
    const model = meterLanguageModel(stubbedProvider(true)('gpt-5.5'), 'agent');
    const result: any = await model.doStream({ prompt } as any);
    const parts: any[] = [];
    const reader = result.stream.getReader();
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      parts.push(step.value);
    }
    expect(parts.filter((p) => p.type === 'text-delta').map((p) => p.delta).join('')).toBe('Hello');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ inputAmount: 14000, outputAmount: 300, cachedAmount: 12800 });
  });
});
