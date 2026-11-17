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
export class DeletePostTool implements AgentToolInterface {
  constructor(
    private _pendingActionService: PendingActionService,
    private _postFacts: PostFactsReader
  ) {}
  name = 'deletePost';

  run() {
    return createTool({
      id: 'deletePost',
      description: `Ask the user to confirm deleting an existing post and any pending publish for it. Pass the post "group" id (from listScheduledPosts, NOT the id). This tool does NOT delete anything by itself: it shows the user a confirmation card, and the post is only deleted if they approve it. Tell the user to use that card - do not ask them to reply "yes" in the chat, and call it once per request. You cannot see whether the user approved or declined an earlier card, and cards expire, so when the user asks again, call it again and show a new card.`,
      inputSchema: z.object({
        group: z
          .string()
          .describe('The post group id from listScheduledPosts.'),
        summary: z
          .string()
          .describe(
            'One short sentence naming what will be deleted, in the user\'s language, e.g. "the LinkedIn post scheduled for Friday 10:00".'
          ),
      }),
      mcp: {
        annotations: {
          title: 'Delete post',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        status: z.enum(['awaiting_confirmation', 'not_found']),
        token: z.string(),
        summary: z.string(),
        group: z.string(),
        expiresInMinutes: z.number(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const { group } = inputData as { group: string };
        // The card says what Approve will delete, read from the posts
        // themselves; the model's own sentence is not shown.
        const posts = await this._postFacts.byGroup(
          organizationId,
          group
        );
        if (!posts?.length) {
          return {
            status: 'not_found' as const,
            token: '',
            summary: 'No post with this group id in this organisation.',
            group,
            expiresInMinutes: 0,
          };
        }
        const summary = confirmationSummary('deletePost', posts);
        const { token, expiresInMinutes } =
          await this._pendingActionService.create({
            kind: 'deletePost',
            organizationId,
            summary,
            payload: { group },
          });

        return {
          status: 'awaiting_confirmation' as const,
          token,
          summary,
          group,
          expiresInMinutes,
        };
      },
    });
  }
}
