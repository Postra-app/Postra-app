import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  confirmationSummary,
  PendingActionService,
} from '@gitroom/nestjs-libraries/chat/pending-action.service';
import { PostFactsReader } from '@gitroom/nestjs-libraries/chat/post-facts.reader';

@Injectable()
export class ReschedulePostTool implements AgentToolInterface {
  constructor(
    private _pendingActionService: PendingActionService,
    private _postFacts: PostFactsReader
  ) {}
  name = 'reschedulePost';

  run() {
    return createTool({
      id: 'reschedulePost',
      description: `Ask the user to confirm moving an existing post to a new date/time. Pass the post "id" (from listScheduledPosts, NOT the group) and the new UTC date. This tool does NOT move anything by itself: it shows the user a confirmation card, and the post moves only if they approve it. Tell the user to use that card - do not ask them to reply "yes" in the chat, and call it once per request. You cannot see whether the user approved or declined an earlier card, and cards expire, so when the user asks again, call it again and show a new card.`,
      inputSchema: z.object({
        id: z.string().describe('The post id from listScheduledPosts.'),
        date: z
          .string()
          .describe('New publish date-time in UTC (ISO 8601).'),
        summary: z
          .string()
          .describe(
            'One short sentence naming the post and the new time, in the user\'s language, e.g. "move the Instagram post to Monday 09:00".'
          ),
      }),
      mcp: {
        annotations: {
          title: 'Reschedule post',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        status: z.enum(['awaiting_confirmation', 'not_found']),
        token: z.string(),
        summary: z.string(),
        id: z.string(),
        date: z.string(),
        expiresInMinutes: z.number(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const { id, date } = inputData as { id: string; date: string };
        // The card says which post moves and from when to when, read from
        // the post itself; the model's own sentence is not shown.
        const post = await this._postFacts.byId(id, organizationId);
        if (!post) {
          return {
            status: 'not_found' as const,
            token: '',
            summary: 'No post with this id in this organisation.',
            id,
            date,
            expiresInMinutes: 0,
          };
        }
        const summary = confirmationSummary('reschedulePost', [post], date);
        const { token, expiresInMinutes } =
          await this._pendingActionService.create({
            kind: 'reschedulePost',
            organizationId,
            summary,
            payload: { id, date },
          });

        return {
          status: 'awaiting_confirmation' as const,
          token,
          summary,
          id,
          date,
          expiresInMinutes,
        };
      },
    });
  }
}
