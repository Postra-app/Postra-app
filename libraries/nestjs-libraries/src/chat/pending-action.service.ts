import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Destructive agent tools do not act; they park what they would have done here
 * and hand back a token. The action only happens when a person clicks Approve
 * in the chat, which calls the confirm endpoint with that token.
 *
 * The gate is on the server on purpose. A prompt that says "always confirm
 * first" is a request, not a control - the model can skip it, and the same
 * tools are reachable over MCP where there is no chat UI to skip it in.
 */
export type PendingActionKind = 'deletePost' | 'reschedulePost';

export interface PendingAction {
  kind: PendingActionKind;
  organizationId: string;
  /** What the agent told the user it was about to do. Shown on the card. */
  summary: string;
  payload: Record<string, string>;
}

/** Long enough to read the card and think, short enough to not linger. */
export const PENDING_ACTION_TTL_SECONDS = 10 * 60;

const redisKey = (token: string) => `agent:pending:${token}`;

@Injectable()
export class PendingActionService {
  async create(
    action: PendingAction
  ): Promise<{ token: string; expiresInMinutes: number }> {
    const token = randomBytes(24).toString('base64url');
    await ioRedis.set(
      redisKey(token),
      JSON.stringify(action),
      'EX',
      PENDING_ACTION_TTL_SECONDS
    );
    return { token, expiresInMinutes: PENDING_ACTION_TTL_SECONDS / 60 };
  }

  /**
   * Returns the action and removes it, so a token works exactly once. The
   * delete is what decides the race: two clicks, one winner, one "expired".
   */
  async consume(
    token: string,
    organizationId: string
  ): Promise<PendingAction | null> {
    const raw = await ioRedis.get(redisKey(token));
    if (!raw) return null;

    let action: PendingAction;
    try {
      action = JSON.parse(raw) as PendingAction;
    } catch {
      return null;
    }

    // A token from another org is treated as absent rather than deleted -
    // nobody else's pending action disappears because of a wrong click.
    if (action.organizationId !== organizationId) return null;

    const removed = await ioRedis.del(redisKey(token));
    if (!removed) return null;

    return action;
  }
}
