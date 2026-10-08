import {
  threadMessagesForCopilotKit,
  threadStateClient,
} from '@gitroom/nestjs-libraries/chat/thread-state';

// Mastra memory's v2 message: { format: 2, parts, content } (prod 2026-10-08).
const v2 = (text: string) => ({
  format: 2,
  parts: [{ type: 'step-start' }, { type: 'text', text }],
  content: text,
});

describe('thread state for CopilotKit', () => {
  it('turns a recalled chat into human and AI messages, in order', () => {
    expect(
      threadMessagesForCopilotKit([
        { id: 'u1', role: 'user', content: v2('Plan next week') },
        { id: 'a1', role: 'assistant', content: v2('Here is the plan') },
      ])
    ).toEqual([
      { id: 'u1', type: 'human', content: 'Plan next week', tool_calls: [] },
      { id: 'a1', type: 'ai', content: 'Here is the plan', tool_calls: [] },
    ]);
  });

  it('reads the text parts when there is no content string', () => {
    const [m] = threadMessagesForCopilotKit([
      {
        id: 'a1',
        role: 'assistant',
        content: { format: 2, parts: [{ type: 'text', text: 'One ' }, { type: 'tool-invocation' }, { type: 'text', text: 'two' }] },
      },
    ]);
    expect(m.content).toBe('One two');
  });

  it('leaves out system and tool messages and empty ones', () => {
    expect(
      threadMessagesForCopilotKit([
        { id: 's', role: 'system', content: 'x' },
        { id: 't', role: 'tool', content: 'x' },
        { id: 'e', role: 'assistant', content: { format: 2, parts: [] } },
      ])
    ).toEqual([]);
  });

  it('answers a thread with messages, and "no thread" for an empty or failing one', async () => {
    const client = threadStateClient(async (id) =>
      id === 'full'
        ? { messages: [{ id: 'u1', role: 'user', content: v2('Hi') }] }
        : id === 'boom'
        ? Promise.reject(new Error('db'))
        : { messages: [] }
    );
    expect((await client.threads.getState('full')).values).toEqual({
      messages: [{ id: 'u1', type: 'human', content: 'Hi', tool_calls: [] }],
    });
    expect((await client.threads.getState('empty')).values).toEqual({});
    expect((await client.threads.getState('boom')).values).toEqual({});
  });
});
