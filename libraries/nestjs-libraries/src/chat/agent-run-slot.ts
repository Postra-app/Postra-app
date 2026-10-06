import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// The agent budget is read before a run and spent as it goes, so every run
// started at the same moment saw the same remaining budget: several chats in
// parallel each ran up to the full allowance (E2E-07-28, BILL-9). Capping the
// runs in flight per organisation bounds that overshoot; the in-run check
// every few steps stops each of them.
export const AGENT_RUNS_PER_ORG = 2;
// A crashed process never releases its slot; the key expires instead. Longer
// than any run (25 steps).
const SLOT_TTL_SECONDS = 600;

// CopilotKit 1.10 GraphQL: a reply is the generateCopilotResponse mutation;
// availableAgents and loadAgentState read metadata and call no model.
export const isAgentGeneration = (body: unknown) => {
  const query = (body as { query?: unknown } | undefined)?.query;
  return typeof query === 'string' && /\bgenerateCopilotResponse\b/.test(query);
};

export const takeAgentRunSlot = async (
  orgId: string
): Promise<(() => Promise<void>) | null> => {
  const key = `agent-runs:${orgId}`;
  const running = await ioRedis.incr(key);
  await ioRedis.expire(key, SLOT_TTL_SECONDS);
  if (running > AGENT_RUNS_PER_ORG) {
    await ioRedis.decr(key);
    return null;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await ioRedis.decr(key);
  };
};
