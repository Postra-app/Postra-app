import { createTool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';

const AI_UNAVAILABLE =
  'AI is unavailable right now. Please try again in a few minutes.';

// AI SDK provider errors (`AI_APICallError`, `AI_RetryError` after its
// retries) from a 5xx, a 429 or no connection.
const isModelOutage = (error: unknown): boolean => {
  const e = error as { name?: string; statusCode?: number } | undefined;
  if (!e?.name?.startsWith('AI_')) return false;
  return !e.statusCode || e.statusCode >= 500 || e.statusCode === 429;
};

type AskableAgent = {
  name: string;
  getDescription(): string;
  generate(
    message: string,
    options: Record<string, unknown>
  ): Promise<{ text: string }>;
};

/**
 * `ask_<key>` for an MCP client. Mastra's MCPServer turns `agents: { … }` into
 * the same tool, but answers with the whole run: every step, the model
 * request with our instructions and tool schemas, the provider's response
 * headers (OpenAI organisation and project) and cookies. That was ~390,000
 * characters for one short answer, more than Claude or ChatGPT accept from a
 * tool. The client only needs the agent's reply.
 */
export const askAgentTool = (key: string, agent: AskableAgent) =>
  createTool({
    id: `ask_${key}`,
    description: `Ask agent '${agent.name}' a question. Agent description: ${agent.getDescription()}`,
    inputSchema: z.object({
      message: z.string().describe('The question or input for the agent.'),
    }),
    outputSchema: z.object({ text: z.string() }),
    execute: async ({ message }, context: any) => {
      // As Mastra does: the MCP request's extras (authInfo, the
      // organisation) reach the agent's tools through the request context.
      const requestContext: RequestContext<Record<string, unknown>> =
        context?.requestContext || new RequestContext();
      Object.entries(context?.mcp?.extra ?? {}).forEach(([name, value]) =>
        requestContext.set(name, value)
      );
      try {
        const { text } = await agent.generate(message, {
          requestContext,
          tracingContext: context?.tracingContext,
          abortSignal: context?.abortSignal,
        });
        return { text };
      } catch (error) {
        // The model provider failing (OpenAI down, rate limited) reached the
        // MCP client as "AI_APICallError: The server had an error", and
        // Claude or ChatGPT read that out. The outage sentence instead.
        if (isModelOutage(error)) {
          throw new Error(AI_UNAVAILABLE);
        }
        throw error;
      }
    },
  });
