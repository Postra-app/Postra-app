// A revoked subscription is only soft-deleted (deletedAt), and a to-one
// include cannot filter on it: the organisation loaded for a request (session,
// API key, OAuth token, impersonation) kept the plan while the permission
// guard, which reads it with deletedAt: null, already said FREE — /user/self,
// the channel and AI limits, the public API and MCP went on as before
// (E2E-07-32). Every such load goes through this.
export const withLiveSubscription = <
  T extends { subscription?: { deletedAt?: Date | null } | null }
>(
  org: T
): T =>
  org?.subscription?.deletedAt ? { ...org, subscription: null } : org;
