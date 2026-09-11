import {
  ChannelState,
  REFRESH_WINDOW_MS,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/channel.state';

/**
 * The same verdict as `channelState`, expressed as a query.
 *
 * Filtering and counting by state has to happen in the database — pulling
 * every channel back to classify it in memory is the shape that stops working
 * on the day it matters. But a second expression of the same rule is exactly
 * how the tier badge ended up correct in one tab and at 2.64:1 in the other
 * (E2E-09-55), so `channel.state.query.spec.ts` runs both against the same
 * rows and fails if they ever disagree about one.
 *
 * Kept out of channel.state.ts because the frontend bundles that file and has
 * no use for query fragments.
 */

/** Not deleted, not switched off, connected, and not flagged for reconnect. */
const HEALTHY: Record<string, unknown> = {
  deletedAt: null,
  disabled: false,
  inBetweenSteps: false,
  refreshNeeded: false,
};

export const channelStateWhere = (
  state: ChannelState,
  now: Date = new Date()
): Record<string, unknown> => {
  const windowEnd = new Date(now.getTime() + REFRESH_WINDOW_MS);

  switch (state) {
    case 'deleted':
      return { deletedAt: { not: null } };
    case 'disabled':
      return { deletedAt: null, disabled: true };
    case 'setup-incomplete':
      return { deletedAt: null, disabled: false, inBetweenSteps: true };
    case 'needs-reconnect':
      return {
        deletedAt: null,
        disabled: false,
        inBetweenSteps: false,
        refreshNeeded: true,
      };
    case 'expired':
      return { ...HEALTHY, tokenExpiration: { lte: now } };
    case 'expiring':
      return { ...HEALTHY, tokenExpiration: { gt: now, lte: windowEnd } };
    case 'ok':
    default:
      // A null expiry belongs here, and Prisma's `gt` would drop it: the four
      // providers that never report one are healthy, not unknown.
      return {
        ...HEALTHY,
        OR: [{ tokenExpiration: null }, { tokenExpiration: { gt: windowEnd } }],
      };
  }
};

/**
 * Providers whose channels sit under a scheduled refresh workflow.
 *
 * Passed in from the integration manager rather than hard-coded, so adding
 * `refreshCron = true` to a provider is enough to move it — the list in a
 * comment somewhere going stale is the other half of this class of bug.
 */
export const notScheduledWhere = (scheduledProviders: string[]) =>
  scheduledProviders.length
    ? { providerIdentifier: { notIn: scheduledProviders } }
    : {};
