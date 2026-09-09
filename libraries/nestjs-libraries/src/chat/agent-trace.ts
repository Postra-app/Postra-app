/**
 * A run log for the agent, because there is no other way to answer "why did it
 * do that". Mastra's own tracing is opt-in and needs an exporter we have not
 * added yet; until then every step and every run writes one flat JSON line to
 * the application log, which already ships to Grafana.
 *
 * What is deliberately NOT logged: prompts, replies, tool arguments and tool
 * results. Those carry the user's post text and their customers' details, and
 * a log is the wrong place for both. Names, counts, tokens and reasons are
 * enough to see the shape of a run.
 */
export interface AgentStepEvent {
  runId?: string;
  model?: { modelId?: string; provider?: string };
  finishReason?: string;
  toolCalls?: { toolName?: string; payload?: { toolName?: string } }[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AgentRunEvent extends AgentStepEvent {
  steps?: unknown[];
  totalUsage?: { inputTokens?: number; outputTokens?: number };
  error?: unknown;
}

const toolNames = (event: AgentStepEvent): string[] =>
  (event.toolCalls ?? [])
    .map((call) => call?.toolName ?? call?.payload?.toolName)
    .filter((name): name is string => !!name);

const errorMessage = (error: unknown): string | undefined => {
  if (!error) return undefined;
  if (typeof error === 'string') return error.slice(0, 200);
  if (error instanceof Error) return error.message.slice(0, 200);
  const message = (error as { message?: string })?.message;
  return message ? String(message).slice(0, 200) : 'unknown error';
};

export const describeAgentStep = (
  organizationId: string | undefined,
  event: AgentStepEvent
) => ({
  event: 'agent.step',
  organizationId: organizationId ?? null,
  runId: event.runId ?? null,
  model: event.model?.modelId ?? null,
  tools: toolNames(event),
  finishReason: event.finishReason ?? null,
  inputTokens: event.usage?.inputTokens ?? 0,
  outputTokens: event.usage?.outputTokens ?? 0,
});

export const describeAgentRun = (
  organizationId: string | undefined,
  event: AgentRunEvent
) => ({
  event: 'agent.run',
  organizationId: organizationId ?? null,
  runId: event.runId ?? null,
  model: event.model?.modelId ?? null,
  steps: event.steps?.length ?? 0,
  finishReason: event.finishReason ?? null,
  inputTokens: event.totalUsage?.inputTokens ?? event.usage?.inputTokens ?? 0,
  outputTokens: event.totalUsage?.outputTokens ?? event.usage?.outputTokens ?? 0,
  error: errorMessage(event.error) ?? null,
});

/** The organisation is on the request context as the serialised record. */
export const organizationIdFromContext = (
  organizationJson: string | undefined
): string | undefined => {
  if (!organizationJson) return undefined;
  try {
    return (JSON.parse(organizationJson) as { id?: string })?.id;
  } catch {
    return undefined;
  }
};
