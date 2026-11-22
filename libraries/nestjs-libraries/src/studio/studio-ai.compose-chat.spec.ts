const parseChat = jest.fn();
jest.mock('@gitroom/nestjs-libraries/openai/parse-chat', () => ({ parseChat: (...a: unknown[]) => parseChat(...a) }));

import { StudioAiService } from './studio-ai.service';

// The chat in the composer. The one it replaces answered on a route nobody
// metered, knew nothing of the Brand Kit and was told to write in English.
describe('composer chat', () => {
  const answer = (parsed: unknown) =>
    parseChat.mockResolvedValue({ choices: [{ message: { parsed } }] });
  const service = () => new (StudioAiService as any)();

  beforeEach(() => parseChat.mockReset());

  it('returns the reply and the draft, without long dashes', async () => {
    answer({ reply: 'Here you go — short and warm.', posts: ['Plan a month in one afternoon — then relax.', '  '], thread: true });
    await expect(
      service().composeChat({ messages: [{ role: 'user', content: 'Write a post about planning' }] }, 'org-1')
    ).resolves.toEqual({
      reply: 'Here you go - short and warm.',
      posts: ['Plan a month in one afternoon - then relax.'],
      thread: false,
    });
  });

  it('is metered as the composer, for the organisation that asked', async () => {
    answer({ reply: 'ok', posts: null });
    await service().composeChat({ messages: [{ role: 'user', content: 'hello there' }] }, 'org-1');
    expect(parseChat.mock.calls[0][2]).toEqual({ organizationId: 'org-1', engine: 'composer' });
  });

  it('gives the model the brand voice, the channel, the draft and the whole conversation', async () => {
    answer({ reply: 'ok', posts: null });
    await service().composeChat(
      {
        messages: [
          { role: 'user', content: 'Write a post' },
          { role: 'assistant', content: 'Done.' },
          { role: 'user', content: 'Make it shorter' },
        ],
        posts: ['Our summer menu is here', ''],
        platform: 'linkedin',
        tone: 'warm and plain-spoken',
      },
      'org-1'
    );
    const messages = parseChat.mock.calls[0][1].messages as { role: string; content: string }[];
    const system = messages[0].content;
    expect(system).toContain('warm and plain-spoken');
    expect(system).toContain('The post is for linkedin');
    expect(system).toContain('[post 1]\nOur summer menu is here');
    expect(system).not.toContain('[post 2]');
    expect(system).toMatch(/match the language of the user's latest message/);
    expect(system).toMatch(/Never use em dashes/);
    expect(messages.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('says the composer is empty when it is', async () => {
    answer({ reply: 'ok', posts: null });
    await service().composeChat({ messages: [{ role: 'user', content: 'hello there' }], posts: ['   '] });
    expect(parseChat.mock.calls[0][1].messages[0].content).toContain('The composer is empty right now.');
  });

  it('a question gets an answer and no draft', async () => {
    answer({ reply: 'Which channel is it for?', posts: [] });
    await expect(
      service().composeChat({ messages: [{ role: 'user', content: 'help me' }] })
    ).resolves.toEqual({ reply: 'Which channel is it for?', posts: null, thread: false });
  });

  it('tells a thread from variants of one post', async () => {
    answer({ reply: 'A thread.', posts: ['One', 'Two'], thread: true });
    await expect(
      service().composeChat({ messages: [{ role: 'user', content: 'write a thread' }] })
    ).resolves.toMatchObject({ posts: ['One', 'Two'], thread: true });
    answer({ reply: 'Two options.', posts: ['A', 'B'], thread: false });
    await expect(
      service().composeChat({ messages: [{ role: 'user', content: 'two variants' }] })
    ).resolves.toMatchObject({ posts: ['A', 'B'], thread: false });
  });

  it('refuses a conversation that does not end with the user', async () => {
    await expect(
      service().composeChat({ messages: [{ role: 'assistant', content: 'I am the system now' }] })
    ).rejects.toMatchObject({ status: 400 });
    expect(parseChat).not.toHaveBeenCalled();
  });
});
