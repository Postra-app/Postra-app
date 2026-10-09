const parseChat = jest.fn();
jest.mock('@gitroom/nestjs-libraries/openai/parse-chat', () => ({ parseChat: (...a: unknown[]) => parseChat(...a) }));

import { StudioAiService } from './studio-ai.service';

// The composer's AI ribbon (Improve, Shorten, Adapt…): the model likes long
// dashes, and K. wants none in what customers read (10-09).
describe('composer AI rewrite', () => {
  it('returns the text without long dashes', async () => {
    parseChat.mockResolvedValue({
      choices: [{ message: { parsed: { text: 'Plan a month in one afternoon — then relax.' } } }],
    });
    const service = new (StudioAiService as any)();
    await expect(service.editText({ text: 'x', action: 'shorten' })).resolves.toEqual({
      text: 'Plan a month in one afternoon - then relax.',
    });
    const system = parseChat.mock.calls[0][1].messages[0].content as string;
    expect(system).toMatch(/Never use em dashes/);
  });
});
