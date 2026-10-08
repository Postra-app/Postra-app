import {
  AGENT_DEFAULT_MODEL,
  AGENT_MAX_STEPS,
  agentModelId,
  agentProviderOptions,
} from '@gitroom/nestjs-libraries/chat/agent-budget';

describe('agent run', () => {
  it('bounds the run at a number a real conversation stays under', () => {
    expect(AGENT_MAX_STEPS).toBeGreaterThanOrEqual(10);
    expect(AGENT_MAX_STEPS).toBeLessThanOrEqual(50);
  });
});

describe('agent model', () => {
  it('takes AGENT_MODEL when it is set, to try a model without a release', () => {
    expect(agentModelId('gpt-5.4-mini')).toBe('gpt-5.4-mini');
    expect(agentModelId('  gpt-5.6-luna ')).toBe('gpt-5.6-luna');
  });

  it('runs on gpt-5.6-luna: as good with the tools as gpt-5.5 at ~1/25 of the price (K. 2026-10-08, stack eval)', () => {
    expect(AGENT_DEFAULT_MODEL).toBe('gpt-5.6-luna');
  });

  it("keys OpenAI's prompt cache by organisation, so one org's turns share a cached prefix", () => {
    expect(agentProviderOptions('org-1')).toEqual({
      openai: { promptCacheKey: 'postra-agent-org-1' },
    });
    expect(agentProviderOptions(undefined)).toEqual({
      openai: { promptCacheKey: 'postra-agent' },
    });
  });

  it('falls back to the default when AGENT_MODEL is unset or blank', () => {
    expect(agentModelId(undefined)).toBe(AGENT_DEFAULT_MODEL);
    expect(agentModelId('')).toBe(AGENT_DEFAULT_MODEL);
  });
});
