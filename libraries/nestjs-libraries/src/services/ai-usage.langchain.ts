import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import {
  AiUsageEvent,
  recordAiUsage,
} from '@gitroom/nestjs-libraries/services/ai-usage.record';
import {
  AiCallOutcome,
  aiCallOutcome,
  observeAiCall,
} from '@gitroom/nestjs-libraries/ai-cost/ai-call.metric';

// LangChain callback that reports token usage of every LLM run in the tree to
// the AiUsage sink. Attach once at the top-level invoke/streamEvents config —
// callbacks propagate to child runs, so all graph nodes are covered.
export class AiUsageCallbackHandler extends BaseCallbackHandler {
  name = 'ai-usage-metering';

  constructor(
    private meta: Pick<AiUsageEvent, 'organizationId' | 'engine'> & {
      model: string;
    }
  ) {
    super();
  }

  // Start times by LangChain run, for the duration of each model call.
  private started = new Map<string, number>();

  override handleLLMStart(_llm: unknown, _prompts: unknown, runId: string) {
    this.started.set(runId, Date.now());
  }

  override handleChatModelStart(_llm: unknown, _messages: unknown, runId: string) {
    this.started.set(runId, Date.now());
  }

  override handleLLMError(err: unknown, runId: string) {
    this.observe(runId, aiCallOutcome(err));
  }

  private observe(runId: string, outcome: AiCallOutcome) {
    const startedAt = this.started.get(runId);
    if (startedAt === undefined) return;
    this.started.delete(runId);
    observeAiCall(this.meta.engine, this.meta.model, outcome, startedAt);
  }

  override handleLLMEnd(output: any, runId?: string) {
    if (runId) this.observe(runId, 'ok');
    const usage =
      output?.llmOutput?.tokenUsage ?? output?.llmOutput?.usage ?? {};
    const inputAmount = usage.promptTokens ?? usage.prompt_tokens ?? 0;
    const outputAmount = usage.completionTokens ?? usage.completion_tokens ?? 0;
    // ChatOpenAI reports the cache hit per generation, not in llmOutput.
    const cachedAmount = (output?.generations ?? [])
      .flat()
      .reduce(
        (sum: number, g: any) =>
          sum +
          (g?.message?.usage_metadata?.input_token_details?.cache_read ?? 0),
        0
      );
    if (inputAmount || outputAmount) {
      recordAiUsage({ ...this.meta, inputAmount, outputAmount, cachedAmount });
    }
  }
}
