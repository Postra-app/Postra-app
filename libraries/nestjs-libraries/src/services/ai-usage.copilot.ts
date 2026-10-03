import { recordAiUsage } from '@gitroom/nestjs-libraries/services/ai-usage.record';

// Meters CopilotKit's OpenAIAdapter, which builds its own OpenAI client and
// streams through beta.chat.completions.stream, out of reach of our model
// wrappers. Asking for include_usage makes OpenAI send token counts in one
// final chunk with no choices, which the adapter's loop already skips. The
// adapter is created per request, so patching its client touches nothing else.
export const meterCopilotAdapter = <T>(
  adapter: T,
  organizationId: string,
  engine: 'autocomplete'
): T => {
  const completions = (adapter as any)?.openai?.beta?.chat?.completions;
  if (!completions?.stream) {
    return adapter;
  }

  const stream = completions.stream.bind(completions);
  completions.stream = (body: any, options?: any) => {
    const running = stream(
      { ...body, stream_options: { ...body?.stream_options, include_usage: true } },
      options
    );
    running.on?.('chunk', (chunk: any) => {
      if (chunk?.usage) {
        recordAiUsage({
          organizationId,
          engine,
          model: body?.model || chunk.model || 'unknown',
          unit: 'tokens',
          inputAmount: chunk.usage.prompt_tokens,
          outputAmount: chunk.usage.completion_tokens,
          cachedAmount: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        });
      }
    });
    return running;
  };

  return adapter;
};
