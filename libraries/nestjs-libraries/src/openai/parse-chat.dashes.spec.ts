import { parseChat } from './parse-chat';

// Every structured AI answer (composer ribbon, post generator, carousels,
// branded drafts, Studio) passes here: no long dashes reach the customer
// (K. 10-09), whatever the model writes.
describe('parseChat', () => {
  it('returns the parsed answer without long dashes', async () => {
    const openai = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ caption: 'Plan once — post everywhere', tags: ['a–b'] }) } }],
          }),
        },
      },
    } as any;
    const result = await parseChat(openai, { model: 'x', messages: [] });
    expect(result.choices[0].message.parsed).toEqual({ caption: 'Plan once - post everywhere', tags: ['a - b'] });
  });
});
