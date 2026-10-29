import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// The agent budget is read before a run and spent as it goes, so every run
// started at the same moment saw the same remaining budget: several chats in
// parallel each ran up to the full allowance. Capping the
// runs in flight per organisation bounds that overshoot; the in-run check
// every few steps stops each of them.
export const AGENT_RUNS_PER_ORG = 2;
// A crashed process never releases its slot; the key expires instead. Longer
// than any run (25 steps).
const SLOT_TTL_SECONDS = 600;

// CopilotKit's single-route envelope ({ method, params, body }): agent/run is
// a reply and agent/suggest asks the model for suggestions; info and
// agent/connect read metadata and call no model.
const GENERATING_METHODS = ['agent/run', 'agent/suggest'];

export const isAgentGeneration = (body: unknown) => {
  const method = (body as { method?: unknown } | undefined)?.method;
  return typeof method === 'string' && GENERATING_METHODS.includes(method);
};

// The runtime keeps every thread's events in one process-wide store, and
// without CopilotKit Intelligence a thread id is the only key to it: any
// signed-in caller holding another organisation's id could connect to that
// chat, continue it or stop it, and the threads/* resource methods read it.
// The agent route answers only these methods, and the ones naming a thread
// are checked against the thread's owner in Mastra memory first.
const AGENT_ROUTE_METHODS = ['info', 'agent/run', 'agent/connect', 'agent/stop', 'agent/suggest'];

export const agentRouteRequest = (
  body: unknown
): { allowed: boolean; threadId?: string } => {
  const { method, params, body: inner } = (body || {}) as {
    method?: unknown;
    params?: { threadId?: unknown };
    body?: { threadId?: unknown };
  };
  if (typeof method !== 'string' || !AGENT_ROUTE_METHODS.includes(method)) {
    return { allowed: false };
  }
  // agent/stop names the thread in params, run and connect in the body.
  const threadId = method === 'agent/stop' ? params?.threadId : inner?.threadId;
  return {
    allowed: true,
    ...(typeof threadId === 'string' && threadId ? { threadId } : {}),
  };
};

export const takeAgentRunSlot = async (
  orgId: string
): Promise<(() => Promise<void>) | null> => {
  const key = `agent-runs:${orgId}`;
  const running = await ioRedis.incr(key);
  if (running > AGENT_RUNS_PER_ORG) {
    await ioRedis.decr(key);
    // No TTL refresh here: refused attempts kept extending a counter left
    // behind by a crashed process, so it never expired.
    return null;
  }
  await ioRedis.expire(key, SLOT_TTL_SECONDS);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await ioRedis.decr(key);
  };
};
