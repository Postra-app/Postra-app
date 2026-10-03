import { AiUsageEvent, setAiUsageSink } from './ai-usage.record';
import { AiUsageCallbackHandler } from './ai-usage.langchain';
import { meterLanguageModel } from './ai-usage.model-wrap';
import { parseChat } from '../openai/parse-chat';

// Cached prompt tokens (P5 §9.3b) reach AiUsage from every text path, so the
// cache hit rate can be measured before prompts are reordered for it.
describe('AiUsage cachedAmount', () => {
  let events: AiUsageEvent[];
  beforeEach(() => {
    events = [];
    setAiUsageSink((e) => events.push(e));
  });

  it('parseChat (OpenAI chat completions)', async () => {
    const openai: any = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: '{}' } }],
            usage: { prompt_tokens: 2000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 1536 } },
          }),
        },
      },
    };
    await parseChat(openai, { model: 'gpt-4.1', messages: [] }, { engine: 'creator', organizationId: 'o' });
    expect(events[0]).toMatchObject({ inputAmount: 2000, outputAmount: 50, cachedAmount: 1536 });
  });

  it('LangChain callback reads the cache hit from each generation', () => {
    new AiUsageCallbackHandler({ engine: 'creator', model: 'gpt-4.1', organizationId: 'o' }).handleLLMEnd({
      llmOutput: { tokenUsage: { promptTokens: 3000, completionTokens: 100 } },
      generations: [[{ message: { usage_metadata: { input_token_details: { cache_read: 2048 } } } }]],
    });
    expect(events[0]).toMatchObject({ inputAmount: 3000, outputAmount: 100, cachedAmount: 2048 });
  });

  it('AI SDK model wrapper (agent)', async () => {
    const model = meterLanguageModel(
      {
        specificationVersion: 'v2',
        provider: 'openai',
        modelId: 'gpt-5.5',
        supportedUrls: {},
        doGenerate: async () => ({ usage: { inputTokens: 14000, outputTokens: 300, cachedInputTokens: 12800 } }),
        doStream: async () => ({}),
      },
      'agent'
    );
    await model.doGenerate({});
    expect(events[0]).toMatchObject({ inputAmount: 14000, outputAmount: 300, cachedAmount: 12800 });
  });

  it('records 0 when the provider says nothing about the cache', () => {
    new AiUsageCallbackHandler({ engine: 'creator', model: 'gpt-4.1' }).handleLLMEnd({
      llmOutput: { tokenUsage: { promptTokens: 10, completionTokens: 1 } },
    });
    expect(events[0].cachedAmount).toBe(0);
  });
});
