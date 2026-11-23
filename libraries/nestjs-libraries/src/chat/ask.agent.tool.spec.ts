import { askAgentTool } from './ask.agent.tool';

// MCP `ask_postra` while OpenAI is down: the agent throws the provider's
// error ("AI_APICallError: The server had an error"), and Claude or ChatGPT
// passed that on to the person. They get the sentence every other AI feature
// gives in an outage.
const agent = (error: Error) => ({
  name: 'postra',
  getDescription: () => 'Postra',
  generate: async () => {
    throw error;
  },
});

const run = (tool: any) => tool.execute({ message: 'plan a post' }, {});

describe('ask_<agent> when the model fails', () => {
  it('answers with the outage sentence, not the provider error', async () => {
    const error = Object.assign(new Error('The server had an error'), {
      name: 'AI_APICallError',
      statusCode: 500,
    });
    await expect(run(askAgentTool('postra', agent(error)))).rejects.toThrow(
      'AI is unavailable right now. Please try again in a few minutes.'
    );
  });

  it('leaves other errors as they are', async () => {
    await expect(
      run(askAgentTool('postra', agent(new Error('Channel not found'))))
    ).rejects.toThrow('Channel not found');
  });
});

// A directory of MCP connectors reads each tool's title and hints to tell a
// person what the tool may do before they allow it. This one had none.
describe('ask_<agent> as an MCP client sees it', () => {
  const tool: any = askAgentTool('postra', {
    name: 'postra',
    getDescription: () => 'Postra',
    generate: async () => ({ text: 'ok' }),
  });

  it('has a title', () => {
    expect(tool.mcp?.annotations?.title).toBe('Ask the Postra assistant');
  });

  it('says it can change things: the assistant can create and schedule posts', () => {
    expect(tool.mcp?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });
});
