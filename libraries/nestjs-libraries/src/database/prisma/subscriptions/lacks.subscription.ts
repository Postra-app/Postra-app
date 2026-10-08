// The public API and the MCP server take an organisation's key, and with
// billing on (STRIPE_PUBLISHABLE_KEY, the switch the rest of billing uses)
// only a subscribed organisation gets in. MCP used to check the key alone,
// so a cancelled organisation kept reading its data through it.
export const lacksSubscription = (
  org?: { subscription?: unknown } | null
) => !!process.env.STRIPE_PUBLISHABLE_KEY && !org?.subscription;
