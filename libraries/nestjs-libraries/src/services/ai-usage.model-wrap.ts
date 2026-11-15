import { AsyncLocalStorage } from 'async_hooks';
import { recordAiUsage } from '@gitroom/nestjs-libraries/services/ai-usage.record';
import { getAuth } from '@gitroom/nestjs-libraries/chat/async.storage';
import {
  AiCallOutcome,
  aiCallOutcome,
  observeAiCall,
  timeAiCall,
} from '@gitroom/nestjs-libraries/ai-cost/ai-call.metric';

// The Mastra agent's model is built once at boot, but usage must be attributed
// per request. The copilot controller runs the request inside this ALS scope;
// the wrapped model reads the orgId back out at call time. MCP runs the agent in
// its own scope (runWithContext, the organisation of the API key or OAuth
// token); without reading it, every MCP run was recorded org-less and never
// counted against the plan. Outside both, the row is org-less.
export const aiUsageOrgContext = new AsyncLocalStorage<string>();

// Hand-rolled delegation instead of ai's wrapLanguageModel: the monorepo hoists
// more than one `ai` major and importing the wrong one type-clashes with the
// LanguageModelV2 that @ai-sdk/openai@2 returns. The interface is structural
// and small, so delegating the five members is safer than the helper.
// LanguageModelV2 reports plain numbers; V3 (the model CopilotKit's adapter
// hands over) reports { total, ... } objects, which recorded NaN.
const tokens = (value: unknown): number =>
  typeof value === 'number'
    ? value
    : (value as { total?: number } | undefined)?.total ?? 0;

export function meterLanguageModel<
  T extends {
    specificationVersion: string;
    provider: string;
    modelId: string;
    supportedUrls: unknown;
    doGenerate(options: any): PromiseLike<any>;
    doStream(options: any): PromiseLike<any>;
  }
>(model: T, engine: 'agent' | 'autocomplete'): T {
  const record = (usage: any) => {
    recordAiUsage({
      organizationId:
        aiUsageOrgContext.getStore() ?? getAuth<{ id?: string }>()?.id ?? null,
      engine,
      model: model.modelId,
      inputAmount: tokens(usage?.inputTokens),
      outputAmount: tokens(usage?.outputTokens),
      cachedAmount: usage?.cachedInputTokens ?? usage?.inputTokens?.cacheRead ?? 0,
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
      const result = await timeAiCall(engine, model.modelId, () =>
        Promise.resolve(model.doGenerate(options))
      );
      record(result?.usage);
      return result;
    },
    doStream: async (options: any) => {
      // From the request to the last part of the answer: what the person
      // waits for on one step of a run.
      const startedAt = Date.now();
      let result: any;
      try {
        result = await model.doStream(options);
      } catch (err) {
        observeAiCall(engine, model.modelId, aiCallOutcome(err), startedAt);
        throw err;
      }
      // One observation per call, whatever the stream does: an error part
      // followed by a finish part is a failed call, not a failed one and a
      // good one, and a stream that breaks or ends without finishing is
      // failed too. A reader that walks away (the chat was closed) is not
      // counted: the call did not end, it was left.
      let observed = false;
      const settle = (outcome: AiCallOutcome) => {
        if (observed) return;
        observed = true;
        observeAiCall(engine, model.modelId, outcome, startedAt);
      };
      const reader = (result.stream as ReadableStream<any>).getReader();
      const stream = new ReadableStream<any>({
        async pull(controller) {
          let step: ReadableStreamReadResult<any>;
          try {
            step = await reader.read();
          } catch (err) {
            settle(aiCallOutcome(err));
            controller.error(err);
            return;
          }
          if (step.done) {
            settle('error');
            controller.close();
            return;
          }
          const part = step.value;
          if (part?.type === 'error') {
            settle(aiCallOutcome(part.error));
          } else if (part?.type === 'finish') {
            record(part.usage);
            settle('ok');
          }
          controller.enqueue(part);
        },
        cancel(reason) {
          observed = true;
          return reader.cancel(reason);
        },
      });
      return { ...result, stream };
    },
  } as unknown as T;
}
