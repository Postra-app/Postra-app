import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import {
  AiUsageEvent,
  recordAiUsage,
} from '@gitroom/nestjs-libraries/services/ai-usage.record';

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

  override handleLLMEnd(output: any) {
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
