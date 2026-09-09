import {
  describeAgentRun,
  describeAgentStep,
  organizationIdFromContext,
} from '@gitroom/nestjs-libraries/chat/agent-trace';

describe('agent run log', () => {
  it('records the shape of a step without its content', () => {
    const line = describeAgentStep('org-1', {
      runId: 'run-9',
      model: { modelId: 'gpt-5.5' },
      finishReason: 'tool-calls',
      toolCalls: [{ toolName: 'listScheduledPosts' }, { toolName: 'deletePost' }],
      usage: { inputTokens: 2810, outputTokens: 64 },
    });

    expect(line).toEqual({
      event: 'agent.step',
      organizationId: 'org-1',
      runId: 'run-9',
      model: 'gpt-5.5',
      tools: ['listScheduledPosts', 'deletePost'],
      finishReason: 'tool-calls',
      inputTokens: 2810,
      outputTokens: 64,
    });

    // The post text and the tool arguments must never reach the log.
    const serialised = JSON.stringify(line);
    expect(serialised).not.toMatch(/text|content|args|prompt/i);
  });

  it('reads tool names from the chunk payload shape too', () => {
    const line = describeAgentStep('org-1', {
      toolCalls: [{ payload: { toolName: 'getAnalytics' } }],
    });
    expect(line.tools).toEqual(['getAnalytics']);
  });

  it('summarises a finished run, including how it failed', () => {
    const line = describeAgentRun('org-2', {
      runId: 'run-3',
      steps: [{}, {}, {}],
      finishReason: 'stop',
      totalUsage: { inputTokens: 9000, outputTokens: 300 },
      error: new Error('provider timed out after 90s'),
    });

    expect(line).toEqual(
      expect.objectContaining({
        event: 'agent.run',
        organizationId: 'org-2',
        steps: 3,
        inputTokens: 9000,
        outputTokens: 300,
        error: 'provider timed out after 90s',
      })
    );
  });

  it('survives an empty event rather than throwing inside a callback', () => {
    expect(describeAgentRun(undefined, {})).toEqual(
      expect.objectContaining({
        organizationId: null,
        steps: 0,
        inputTokens: 0,
        error: null,
      })
    );
  });

  it('pulls the organisation id off the serialised context', () => {
    expect(organizationIdFromContext(JSON.stringify({ id: 'org-7' }))).toEqual(
      'org-7'
    );
    expect(organizationIdFromContext('not json')).toBeUndefined();
    expect(organizationIdFromContext(undefined)).toBeUndefined();
  });
});
