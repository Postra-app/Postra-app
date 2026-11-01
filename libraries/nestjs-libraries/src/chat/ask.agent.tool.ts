import { createTool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';

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
      const { text } = await agent.generate(message, {
        requestContext,
        tracingContext: context?.tracingContext,
        abortSignal: context?.abortSignal,
      });
      return { text };
    },
  });
