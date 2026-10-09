import OpenAI from 'openai';
import { deepWithoutLongDashes } from '@gitroom/helpers/utils/long.dashes';
import {
  AiUsageEvent,
  recordAiUsage,
} from '@gitroom/nestjs-libraries/services/ai-usage.record';

/**
 * openai-node 6.x: `chat.completions.parse()` rejects `response_format`
 * ("Unknown parameter") because it routes to the Responses API. Use `.create()`
 * with the same `zodResponseFormat()` body — the server still enforces the JSON
 * schema (strict) — and JSON.parse the content ourselves, preserving the
 * `{ choices: [{ message: { parsed } }] }` shape so call sites stay unchanged.
 *
 * Shared by OpenaiService and StudioAiService so the fix lives in one place and
 * the two can't drift back to the broken `.parse()` call.
 *
 * `meter` (optional) reports token usage to the observational AiUsage sink —
 * being the single funnel for structured text completions makes this the one
 * place where every retry attempt is naturally counted.
 */
export async function parseChat(
  openai: OpenAI,
  body: any,
  meter?: Pick<AiUsageEvent, 'organizationId' | 'engine'>
): Promise<{
  choices: Array<{ message: { parsed: any; content: string | null } }>;
}> {
  const completion = (await openai.chat.completions.create(body)) as unknown as {
    choices: Array<{ message: { content: string | null } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  if (meter) {
    recordAiUsage({
      ...meter,
      model: body?.model ?? 'unknown',
      inputAmount: completion.usage?.prompt_tokens ?? 0,
      outputAmount: completion.usage?.completion_tokens ?? 0,
      cachedAmount: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    });
  }
  return {
    choices: completion.choices.map((c) => {
      const content = c.message?.content ?? null;
      let parsed: any = null;
      if (content) {
        try {
          // No long dashes in what customers read (K. 10-09): the prompts
          // ask for none, this makes sure.
          parsed = deepWithoutLongDashes(JSON.parse(content));
        } catch {
          parsed = null;
        }
      }
      return { message: { parsed, content } };
    }),
  };
}
