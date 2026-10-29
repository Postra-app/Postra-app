import { OpenAIAdapter } from '@copilotkit/runtime';
import OpenAI from 'openai';
import { setAiUsageSink } from './ai-usage.record';
import { aiUsageOrgContext } from './ai-usage.model-wrap';
import { meterCopilotAdapter } from './ai-usage.copilot';

const finishOnly = () =>
  new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'text-delta', delta: 'Hi' });
      controller.enqueue({
        type: 'finish',
        usage: { inputTokens: 13, outputTokens: 12, cachedInputTokens: 0 },
      });
      controller.close();
    },
  });

const drain = async (stream: ReadableStream<any>) => {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // read to the end
  }
};

// The runtime runs the adapter's AI SDK model in its built-in agent and never
// calls the adapter; the old patch on the adapter's OpenAI client recorded
// nothing on CopilotKit 1.83.
describe('meterCopilotAdapter', () => {
  it('records the usage of the model the runtime takes from the adapter', async () => {
    const events: any[] = [];
    setAiUsageSink((e) => events.push(e));
    const model = {
      specificationVersion: 'v2',
      provider: 'openai.chat',
      modelId: 'gpt-4.1',
      supportedUrls: {},
      doGenerate: async () => ({}),
      doStream: async () => ({ stream: finishOnly() }),
    };
    const adapter = meterCopilotAdapter({ getLanguageModel: () => model }, 'autocomplete');

    await aiUsageOrgContext.run('org-1', async () => {
      const { stream } = await adapter.getLanguageModel().doStream({});
      await drain(stream);
    });

    expect(events).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        engine: 'autocomplete',
        model: 'gpt-4.1',
        inputAmount: 13,
        outputAmount: 12,
      }),
    ]);
  });

  it('reads the usage of a LanguageModelV3, which CopilotKit 1.83 hands over', async () => {
    const events: any[] = [];
    setAiUsageSink((e) => events.push(e));
    const model = {
      specificationVersion: 'v3',
      provider: 'openai.responses',
      modelId: 'gpt-4.1',
      supportedUrls: {},
      doGenerate: async () => ({
        usage: {
          inputTokens: { total: 40, noCache: 30, cacheRead: 10, cacheWrite: 0 },
          outputTokens: { total: 6, text: 6, reasoning: 0 },
        },
      }),
      doStream: async () => ({ stream: finishOnly() }),
    };
    const adapter = meterCopilotAdapter({ getLanguageModel: () => model }, 'autocomplete');
    await aiUsageOrgContext.run('org-1', () => adapter.getLanguageModel().doGenerate({}));
    expect(events).toEqual([
      expect.objectContaining({ inputAmount: 40, outputAmount: 6, cachedAmount: 10 }),
    ]);
  });

  it("wraps CopilotKit's own OpenAIAdapter", () => {
    const adapter = meterCopilotAdapter(
      // A client with a key, or the adapter builds one from OPENAI_API_KEY.
      new OpenAIAdapter({ model: 'gpt-4.1', openai: new OpenAI({ apiKey: 'test' }) as any }),
      'autocomplete'
    );
    const model = (adapter as any).getLanguageModel();
    expect(model.modelId).toBe('gpt-4.1');
    // Our wrapper, not the AI SDK model itself.
    expect(Object.getOwnPropertyDescriptor(model, 'supportedUrls')?.get).toBeDefined();
  });

  it('leaves an adapter it does not recognise alone', () => {
    const adapter = { something: true };
    expect(meterCopilotAdapter(adapter, 'autocomplete')).toBe(adapter);
  });
});
