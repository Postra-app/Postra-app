// Fire-and-forget sink for text-AI usage events. Call sites (parseChat,
// LangChain callbacks, the Mastra model wrapper, Whisper) live in plain
// functions with no NestJS DI, so they report through this module-level hook;
// AiUsageService plugs the actual Prisma writer in at module init. Events are
// observational — losing one (sink unset, insert failure) must never break an
// AI call, hence the swallow-everything semantics.

export interface AiUsageEvent {
  organizationId?: string | null;
  engine:
    | 'agent'
    | 'generate-posts'
    | 'autopost'
    | 'creator'
    | 'studio'
    | 'whisper'
    | 'insert-graph'
    // Images and embeddings from the /media surfaces: the composer's AI
    // Image, Studio's AI tab and template search.
    | 'media';
  model: string;
  unit?: 'tokens' | 'seconds' | 'images';
  inputAmount?: number;
  outputAmount?: number;
}

let sink: ((event: AiUsageEvent) => void) | null = null;

export const setAiUsageSink = (fn: (event: AiUsageEvent) => void) => {
  sink = fn;
};

export const recordAiUsage = (event: AiUsageEvent) => {
  try {
    sink?.(event);
  } catch {
    // observational only — never let metering break the AI call
  }
};
