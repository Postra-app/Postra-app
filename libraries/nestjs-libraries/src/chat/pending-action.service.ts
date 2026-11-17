import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { htmlToText } from '@gitroom/helpers/utils/html.to.text';

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
  /**
   * What the card says. Written by the server from the post itself
   * (confirmationSummary), never by the model: the card must describe what
   * Approve will do, and the model's sentence could name another post.
   */
  summary: string;
  payload: Record<string, string>;
}

type PostFacts = {
  publishDate?: Date | string | null;
  content?: string | null;
  integration?: { name?: string | null; providerIdentifier?: string | null } | null;
};

const when = (date?: Date | string | null) => {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

const opening = (content?: string | null) => {
  const text = htmlToText(content || '').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

const channel = (post: PostFacts) =>
  `${post.integration?.providerIdentifier || 'channel'} "${
    post.integration?.name || ''
  }"`;

/**
 * The card's text, from the rows Approve will act on. `posts` are the
 * group's posts (delete) or the one post (reschedule).
 */
export const confirmationSummary = (
  kind: PendingActionKind,
  posts: PostFacts[],
  newDate?: string
) => {
  const first = posts[0];
  const text = opening(first?.content);
  const quote = text ? `: "${text}"` : '';
  if (kind === 'reschedulePost') {
    return `Move the post on ${channel(first)} from ${
      when(first?.publishDate) || 'no date'
    } to ${when(newDate) || newDate}${quote}`;
  }
  const channels = posts.map(channel).filter((c, i, all) => all.indexOf(c) === i);
  const date = when(first?.publishDate);
  return `Delete the post on ${channels.join(', ')}${
    date ? ` scheduled for ${date}` : ''
  }${quote}`;
};

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
