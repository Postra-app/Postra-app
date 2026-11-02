import { readFileSync } from 'fs';
import { join } from 'path';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { z } from 'zod';
import {
  AGENT_MAX_RUN_MS,
  AGENT_MAX_STEPS,
  agentRunDeadline,
} from '@gitroom/nestjs-libraries/chat/agent-budget';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

// A model that never stops asking for the tool: what a run stuck between two
// tools looks like. Each tool call takes 50 s of (fake) wall clock.
const loopingAgent = (clock: { now: number }, calls: { count: number }) =>
  new Agent({
    id: 'deadline-test',
    name: 'deadline-test',
    instructions: 'test',
    model: new MockLanguageModelV3({
      doStream: async () => {
        calls.count += 1;
        return {
          stream: convertArrayToReadableStream([
            { type: 'stream-start', warnings: [] },
            {
              type: 'tool-call',
              toolCallId: `call-${calls.count}`,
              toolName: 'slow',
              input: '{}',
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
              usage,
            },
          ] as never),
        };
      },
    }),
    tools: {
      slow: createTool({
        id: 'slow',
        description: 'slow tool',
        inputSchema: z.object({}),
        execute: async () => {
          clock.now += 50_000;
          return { ok: true };
        },
      }),
    },
    defaultOptions: () =>
      ({
        maxSteps: AGENT_MAX_STEPS,
        stopWhen: agentRunDeadline(() => clock.now),
      }) as never,
  });

describe('agent run deadline', () => {
  it('ends a run that is still going after the ceiling, well before the step limit', async () => {
    const clock = { now: 0 };
    const calls = { count: 0 };
    const stream = await loopingAgent(clock, calls).stream('hi');
    await stream.consumeStream();

    // 50 s per step: past 120 s after the third step, so the run stops there
    // instead of going on to 25.
    expect(calls.count).toBe(Math.ceil(AGENT_MAX_RUN_MS / 50_000));
    expect(calls.count).toBeLessThan(AGENT_MAX_STEPS);
  });

  it('is measured from the start of each run', () => {
    let now = 1_000;
    const done = agentRunDeadline(() => now);
    now += AGENT_MAX_RUN_MS - 1;
    expect(done()).toBe(false);
    now += 1;
    expect(done()).toBe(true);
  });

  it('is set on the assistant next to the step limit', () => {
    const source = readFileSync(join(__dirname, 'load.tools.service.ts'), 'utf8');
    expect(source).toMatch(/maxSteps: AGENT_MAX_STEPS,\s*stopWhen: agentRunDeadline\(\),/);
  });
});
