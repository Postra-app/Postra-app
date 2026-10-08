/**
 * A chat thread in the shape CopilotKit's runtime reads when it loads a thread
 * (`client.threads.getState(threadId).values.messages`, LangChain-style
 * messages it converts with langchainMessagesToCopilotKit).
 *
 * The runtime has no state client for a Mastra agent, so loadAgentState
 * answered "no messages" and the browser replaced the history it had just
 * loaded with an empty chat (K. 2026-10-08: a chat opened again showed only
 * the greeting). The messages come from the same Mastra memory as
 * GET /copilot/:thread/list.
 */
export interface RecalledMessage {
  id: string;
  role: string;
  content: unknown;
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const value = content as { content?: unknown; parts?: unknown };
  if (typeof value.content === 'string' && value.content) return value.content;
  if (Array.isArray(value.parts)) {
    return value.parts
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('');
  }
  return '';
};

export const threadMessagesForCopilotKit = (messages: RecalledMessage[] = []) =>
  messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      type: m.role === 'user' ? 'human' : 'ai',
      content: textOf(m.content),
      // The converter walks tool_calls of every AI message.
      tool_calls: [] as unknown[],
    }))
    .filter((m) => m.content);

export const threadStateClient = (
  recall: (threadId: string) => Promise<{ messages?: RecalledMessage[] }>
) => ({
  threads: {
    getState: async (threadId: string) => {
      try {
        const messages = threadMessagesForCopilotKit(
          (await recall(threadId))?.messages
        );
        // No messages = "thread does not exist" to CopilotKit, as before.
        return { values: messages.length ? { messages } : {} };
      } catch {
        return { values: {} };
      }
    },
  },
});
