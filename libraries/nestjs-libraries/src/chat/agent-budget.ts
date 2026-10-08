/**
 * A conversation that needs more than this many tool calls is not working, it
 * is looping. The budget is only checked once, before the request, so without
 * a ceiling a single message could spend a month's allowance inside one run.
 */
export const AGENT_MAX_STEPS = 25;
/** Re-reading the ledger every step would put a query between every tool. */
export const BUDGET_CHECK_EVERY_STEPS = 3;

/**
 * The OpenAI model behind the assistant (chat and MCP `ask_postra`).
 * AGENT_MODEL overrides it, so another model can be tried on a stack or on
 * production without a release.
 */
// gpt-5.6-luna since 2026-10-08: on the stack's agent scenarios (channels,
// schedule with UK time, Polish, next free slot, branded draft, reschedule)
// it used the same tools as gpt-5.5 and kept the "confirm before
// scheduling" rule, at ~1/25 of the price; gpt-5.4-mini scheduled without
// asking and put a "next free slot" post at the current minute.
export const AGENT_DEFAULT_MODEL = 'gpt-5.6-luna';
export const agentModelId = (value = process.env.AGENT_MODEL): string =>
  value?.trim() || AGENT_DEFAULT_MODEL;

/**
 * OpenAI routes calls with the same prompt_cache_key to the same cache, so
 * one organisation's turns (same instructions, tools and history) hit it
 * more often; a cached input token costs a tenth.
 */
export const agentProviderOptions = (organizationId: string | undefined) => ({
  openai: {
    promptCacheKey: organizationId
      ? `postra-agent-${organizationId}`
      : 'postra-agent',
  },
});

import { getAuth } from '@gitroom/nestjs-libraries/chat/async.storage';

/**
 * The organisation of an agent run, as JSON. The chat sets `organization` on
 * the request context; a run through MCP (`ask_postra`) has it only as the
 * MCP auth info, or in the MCP request's scope, so the budget check below
 * never knew whose run it was (E2E-08-47).
 */
export const organizationOfRun = (requestContext: {
  get(key: string): unknown;
}): string | undefined => {
  const organization = requestContext.get('organization');
  if (typeof organization === 'string' && organization) return organization;
  const auth = requestContext.get('authInfo') ?? getAuth();
  return auth ? JSON.stringify(auth) : undefined;
};

/**
 * Stop the run when the organisation has spent its monthly agent allowance.
 * Exported so the branches can be tested: the wrong answer here either lets a
 * loop run past the limit or cuts somebody off mid-sentence.
 */
export const shouldStopForBudget = async (
  stepCount: number,
  organizationJson: string | undefined,
  checkCredits: (organization: unknown) => Promise<{ credits: number }>,
  billingOn = !!process.env.STRIPE_PUBLISHABLE_KEY
): Promise<boolean> => {
  // Without billing the ledger is advisory, same rule the controller uses.
  if (!billingOn) return false;
  if (!stepCount || stepCount % BUDGET_CHECK_EVERY_STEPS !== 0) return false;
  if (!organizationJson) return false;
  try {
    const { credits } = await checkCredits(JSON.parse(organizationJson));
    return credits <= 0;
  } catch {
    // Never end someone's conversation because a check failed.
    return false;
  }
};
