// The AI cooldown: an organisation nobody has paid for yet (a trial, or no
// plan) waits an hour after signup before it can spend AI. One rule for every
// way in: the Studio and composer buttons (AccountAgeGuard), the assistant,
// the public API and MCP (SubscriptionService.useCredit). Only the buttons
// had it, so a fresh trial asked the assistant or the API instead.
export const AI_COOLDOWN_MS = 60 * 60 * 1000;

export const aiCooldownMessage = (
  createdAt: Date | string | null | undefined,
  now = Date.now()
): string | null => {
  if (!createdAt) {
    return null;
  }
  const age = now - new Date(createdAt).getTime();
  if (!(age < AI_COOLDOWN_MS)) {
    return null;
  }
  const minutesLeft = Math.max(1, Math.ceil((AI_COOLDOWN_MS - age) / 60_000));
  return `AI tools unlock one hour after signup, in ${minutesLeft} ${
    minutesLeft === 1 ? 'minute' : 'minutes'
  }. Try our templates in the meantime!`;
};
