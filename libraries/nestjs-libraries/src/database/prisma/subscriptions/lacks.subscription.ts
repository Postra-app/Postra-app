import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// The public API and the MCP server take an organisation's key, and with
// billing on (STRIPE_PUBLISHABLE_KEY, the switch the rest of billing uses)
// only a subscribed organisation gets in. MCP used to check the key alone,
// so a cancelled organisation kept reading its data through it.
//
// And only a plan that includes the public API: the plans' public_api flag
// decided nothing (E2E-08-48). Every tier a subscription can have includes
// it today (FREE is "no subscription"); pricing.spec pins that.
export const lacksSubscription = (
  org?: { subscription?: { subscriptionTier?: string } | null } | null
) =>
  !!process.env.STRIPE_PUBLISHABLE_KEY &&
  (!org?.subscription ||
    !pricing[org.subscription.subscriptionTier as keyof typeof pricing]
      ?.public_api);
