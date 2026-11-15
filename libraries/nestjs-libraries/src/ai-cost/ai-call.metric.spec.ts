import { register } from 'prom-client';
import { RateLimitError } from 'openai';
import {
  AI_CALL_METRIC,
  aiCallOutcome,
  timeAiCall,
} from '@gitroom/nestjs-libraries/ai-cost/ai-call.metric';
import { AiUsageCallbackHandler } from '@gitroom/nestjs-libraries/services/ai-usage.langchain';
import { meterLanguageModel } from '@gitroom/nestjs-libraries/services/ai-usage.model-wrap';

const counts = async () => {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === AI_CALL_METRIC);
  return Object.fromEntries(
    (metric?.values ?? [])
      .filter((v: any) => v.metricName === `${AI_CALL_METRIC}_count`)
      .map((v: any) => [`${v.labels.engine}/${v.labels.model}/${v.labels.outcome}`, v.value])
  );
};

// AiUsage records what a call cost. How long it took and how often it failed
// was recorded nowhere.
describe('AI call duration', () => {
  beforeEach(() => register.resetMetrics());

  it('times a call that answers and one that fails, and passes both through', async () => {
    await expect(timeAiCall('studio', 'gpt-4.1', async () => 'text')).resolves.toBe('text');
    await expect(
      timeAiCall('media', 'gpt-image-2', async () => {
        throw Object.assign(new Error('blocked'), { status: 400 });
      })
    ).rejects.toThrow('blocked');
    expect(await counts()).toEqual({ 'studio/gpt-4.1/ok': 1, 'media/gpt-image-2/refused': 1 });
  });

  it('tells the provider being down from a refusal from our own fault', () => {
    expect(aiCallOutcome(new RateLimitError(429, undefined, 'slow down', new Headers()))).toBe('outage');
    expect(aiCallOutcome({ statusCode: 503 })).toBe('outage');
    expect(aiCallOutcome({ status: 422 })).toBe('refused');
    expect(aiCallOutcome(new TypeError('x'))).toBe('error');
  });

  it('times each LangChain model call of a graph, failed ones too', async () => {
    const handler = new AiUsageCallbackHandler({ organizationId: 'o', engine: 'generate-posts', model: 'gpt-4.1' });
    handler.handleChatModelStart({}, [], 'run-1');
    handler.handleLLMEnd({ llmOutput: {} }, 'run-1');
    handler.handleChatModelStart({}, [], 'run-2');
    handler.handleLLMError({ status: 500 }, 'run-2');
    expect(await counts()).toEqual({
      'generate-posts/gpt-4.1/ok': 1,
      'generate-posts/gpt-4.1/outage': 1,
    });
  });

  it("times the assistant's streamed step up to its last part", async () => {
    const model = meterLanguageModel(
      {
        specificationVersion: 'v2',
        provider: 'openai',
        modelId: 'gpt-5.6-luna',
        supportedUrls: {},
        doGenerate: async () => ({ usage: {} }),
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-delta' });
              controller.enqueue({ type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } });
              controller.close();
            },
          }),
        }),
      },
      'agent'
    );
    const { stream } = await model.doStream({});
    const reader = (stream as ReadableStream).getReader();
    while (!(await reader.read()).done);
    await model.doGenerate({});
    expect(await counts()).toEqual({ 'agent/gpt-5.6-luna/ok': 2 });
  });
});
