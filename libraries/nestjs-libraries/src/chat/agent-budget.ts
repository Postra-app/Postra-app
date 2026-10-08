/**
 * A conversation that needs more than this many tool calls is not working, it
 * is looping. The budget is only checked once, before the request, so without
 * a ceiling a single message could spend a month's allowance inside one run.
 */
export const AGENT_MAX_STEPS = 25;
/** Re-reading the ledger every step would put a query between every tool. */
export const BUDGET_CHECK_EVERY_STEPS = 3;

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
