const counters = new Map<string, number>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    incr: jest.fn(async (k: string) => {
      counters.set(k, (counters.get(k) ?? 0) + 1);
      return counters.get(k);
    }),
    decr: jest.fn(async (k: string) => {
      counters.set(k, (counters.get(k) ?? 0) - 1);
      return counters.get(k);
    }),
    expire: jest.fn(async () => 1),
  },
}));

import {
  AGENT_RUNS_PER_ORG,
  isAgentGeneration,
  takeAgentRunSlot,
} from './agent-run-slot';

// E2E-07-28: parallel agent chats each passed the budget check and together
// ran past the organisation's allowance.
describe('agent runs in flight per organisation', () => {
  beforeEach(() => counters.clear());

  it(`allows ${AGENT_RUNS_PER_ORG} at once and refuses the next`, async () => {
    const slots = await Promise.all(
      Array.from({ length: AGENT_RUNS_PER_ORG + 1 }, () => takeAgentRunSlot('org-1'))
    );
    expect(slots.filter(Boolean)).toHaveLength(AGENT_RUNS_PER_ORG);
    expect(counters.get('agent-runs:org-1')).toBe(AGENT_RUNS_PER_ORG);
    // Another organisation is not affected.
    expect(await takeAgentRunSlot('org-2')).not.toBeNull();
  });

  it('a finished run frees its slot once, however often it is released', async () => {
    const first = (await takeAgentRunSlot('org-1'))!;
    await takeAgentRunSlot('org-1');
    expect(await takeAgentRunSlot('org-1')).toBeNull();
    await first();
    await first();
    expect(counters.get('agent-runs:org-1')).toBe(AGENT_RUNS_PER_ORG - 1);
    expect(await takeAgentRunSlot('org-1')).not.toBeNull();
  });
});

it('only a reply takes a slot, not the metadata the chat loads on every page', () => {
  expect(
    isAgentGeneration({
      operationName: 'generateCopilotResponse',
      query: 'mutation generateCopilotResponse($data: GenerateCopilotResponseInput!) { generateCopilotResponse(data: $data) { threadId } }',
    })
  ).toBe(true);
  expect(isAgentGeneration({ operationName: 'availableAgents', query: 'query availableAgents { availableAgents { agents { name } } }' })).toBe(false);
  expect(isAgentGeneration({ operationName: 'loadAgentState', query: 'query loadAgentState($data: LoadAgentStateInput!) { loadAgentState(data: $data) { state } }' })).toBe(false);
  expect(isAgentGeneration(undefined)).toBe(false);
});
