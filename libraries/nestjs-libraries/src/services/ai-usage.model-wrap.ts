import { AsyncLocalStorage } from 'async_hooks';
import { recordAiUsage } from '@gitroom/nestjs-libraries/services/ai-usage.record';

// The Mastra agent's model is built once at boot, but usage must be attributed
// per request. The copilot controller runs the request inside this ALS scope;
// the wrapped model reads the orgId back out at call time. If a call ever lands
// outside the scope the row is simply recorded org-less.
export const aiUsageOrgContext = new AsyncLocalStorage<string>();

// Hand-rolled delegation instead of ai's wrapLanguageModel: the monorepo hoists
// more than one `ai` major and importing the wrong one type-clashes with the
// LanguageModelV2 that @ai-sdk/openai@2 returns. The interface is structural
// and small, so delegating the five members is safer than the helper.
export function meterLanguageModel<
  T extends {
    specificationVersion: string;
    provider: string;
    modelId: string;
    supportedUrls: unknown;
    doGenerate(options: any): PromiseLike<any>;
    doStream(options: any): PromiseLike<any>;
  }
>(model: T, engine: 'agent'): T {
  const record = (usage: any) => {
    recordAiUsage({
      organizationId: aiUsageOrgContext.getStore() ?? null,
      engine,
      model: model.modelId,
      inputAmount: usage?.inputTokens ?? 0,
      outputAmount: usage?.outputTokens ?? 0,
      cachedAmount: usage?.cachedInputTokens ?? 0,
    });
  };

  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    get supportedUrls() {
      return model.supportedUrls;
    },
    doGenerate: async (options: any) => {
      const result = await model.doGenerate(options);
      record(result?.usage);
      return result;
    },
    doStream: async (options: any) => {
      const result = await model.doStream(options);
      const stream: ReadableStream<any> = result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part?.type === 'finish') {
              record(part.usage);
            }
            controller.enqueue(part);
          },
        })
      );
      return { ...result, stream };
    },
  } as unknown as T;
}
